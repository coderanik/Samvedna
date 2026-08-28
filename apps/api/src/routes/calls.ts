import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import { bridgeCounsellorCall } from "../lib/exotel-bridge";
import { isExotelConfigured } from "../lib/exotel";
import type { Server as SocketServer } from "socket.io";
import type { CallRouting, IncomingCallEvent, RiskLevel } from "@samvedna/shared-types";

function routeCallType(riskLevel: RiskLevel): "counsellor" | "ai_voice" {
  return riskLevel === "high" || riskLevel === "critical" ? "counsellor" : "ai_voice";
}

async function getLatestRisk(caseId: string): Promise<{ risk_level: RiskLevel; score: number | null }> {
  const { data } = await supabaseAdmin
    .from("distress_scores")
    .select("risk_level, score")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return {
    risk_level: (data?.risk_level as RiskLevel) ?? "low",
    score: data?.score ?? null,
  };
}

export function callsRouter(io: SocketServer) {
  const router = Router();

  router.get("/routing", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const { data: caseRow } = await supabaseAdmin
        .from("cases")
        .select(`
          id, case_number, assigned_counsellor_id,
          counsellor:profiles!cases_assigned_counsellor_id_fkey(id, full_name, phone_number)
        `)
        .eq("victim_id", req.user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!caseRow) return res.status(404).json({ error: "No case found for your account" });

      const { risk_level, score } = await getLatestRisk(caseRow.id);
      const call_type = routeCallType(risk_level);
      const counsellorRaw = caseRow.counsellor;
      const counsellor = (Array.isArray(counsellorRaw) ? counsellorRaw[0] : counsellorRaw) as {
        id: string;
        full_name: string;
        phone_number: string | null;
      } | null;

      const routing: CallRouting = {
        call_type,
        risk_level,
        distress_score: score,
        reason:
          call_type === "counsellor"
            ? `Distress is ${risk_level} (score ${score ?? "—"}) → counsellor call required.`
            : `Distress is ${risk_level} (score ${score ?? "—"}) → AI voice wellness call.`,
        case_id: caseRow.id,
        case_number: caseRow.case_number,
        counsellor:
          call_type === "counsellor" && counsellor
            ? { id: counsellor.id, full_name: counsellor.full_name, phone_number: counsellor.phone_number }
            : undefined,
      };

      res.json(routing);
    } catch (err) {
      next(err);
    }
  });

  router.post("/start", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const { data: caseRow } = await supabaseAdmin
        .from("cases")
        .select("id, case_number, assigned_counsellor_id, victim:profiles!cases_victim_id_fkey(full_name)")
        .eq("victim_id", req.user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!caseRow) return res.status(404).json({ error: "No case found" });

      const { risk_level, score } = await getLatestRisk(caseRow.id);
      const call_type = routeCallType(risk_level);
      const counsellor_id = call_type === "counsellor" ? caseRow.assigned_counsellor_id : null;

      const { data: session, error } = await supabaseAdmin
        .from("call_sessions")
        .insert({
          case_id: caseRow.id,
          victim_id: req.user!.id,
          counsellor_id,
          call_type,
          status: "requested",
          risk_level_at_call: risk_level,
          distress_score_at_call: score,
        })
        .select()
        .single();

      if (error || !session) return res.status(500).json({ error: "Failed to start call session" });

      if (call_type === "counsellor" && counsellor_id) {
        const victimRaw = caseRow.victim;
        const victim = (Array.isArray(victimRaw) ? victimRaw[0] : victimRaw) as { full_name: string } | null;
        io.to(`user:${counsellor_id}`).emit("incoming_call", {
          call_session: session,
          case_number: caseRow.case_number,
          victim_name: victim?.full_name ?? "Victim",
          call_type: "counsellor",
        } satisfies IncomingCallEvent);
      }

      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  });

  router.get("/pending", requireAuth, requireRole("counsellor"), async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("call_sessions")
        .select(`
          *,
          case:cases(case_number),
          victim:profiles!call_sessions_victim_id_fkey(full_name, phone_number)
        `)
        .eq("counsellor_id", req.user!.id)
        .eq("call_type", "counsellor")
        .in("status", ["requested", "ringing", "in_progress"])
        .order("created_at", { ascending: false });

      if (error) return res.status(500).json({ error: "Failed to fetch calls" });
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/status", requireAuth, async (req, res, next) => {
    try {
      const { data: session } = await supabaseAdmin
        .from("call_sessions")
        .select("*")
        .eq("id", req.params.id)
        .single();

      if (!session) return res.status(404).json({ error: "Not found" });

      const userId = req.user!.id;
      if (session.victim_id !== userId && session.counsellor_id !== userId && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/status", requireAuth, async (req, res, next) => {
    try {
      const body = z
        .object({
          status: z.enum(["requested", "ringing", "in_progress", "completed", "missed", "cancelled"]),
        })
        .parse(req.body);

      const { data: session } = await supabaseAdmin
        .from("call_sessions")
        .select("*")
        .eq("id", req.params.id)
        .single();

      if (!session) return res.status(404).json({ error: "Call session not found" });

      const userId = req.user!.id;
      const canUpdate =
        session.victim_id === userId || session.counsellor_id === userId || req.user!.role === "admin";
      if (!canUpdate) return res.status(403).json({ error: "Access denied" });

      const updates: Record<string, unknown> = { status: body.status };
      if (body.status === "in_progress") updates.started_at = new Date().toISOString();
      if (["completed", "missed", "cancelled"].includes(body.status)) {
        updates.ended_at = new Date().toISOString();
      }

      const { data, error } = await supabaseAdmin
        .from("call_sessions")
        .update(updates)
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) return res.status(500).json({ error: "Failed to update call" });

      if (body.status === "in_progress" && session.victim_id) {
        io.to(`user:${session.victim_id}`).emit("call_accepted", {
          call_session_id: session.id,
          counsellor_id: session.counsellor_id,
        });

        if (session.call_type === "counsellor" && isExotelConfigured()) {
          bridgeCounsellorCall(session.id).catch((err) =>
            console.warn("[Exotel] Auto-bridge failed:", err instanceof Error ? err.message : err)
          );
        }
      }

      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/complete", requireAuth, async (req, res, next) => {
    try {
      const body = z
        .object({
          transcript: z.string().optional(),
          duration_seconds: z.number().int().optional(),
        })
        .parse(req.body);

      const { data: session } = await supabaseAdmin
        .from("call_sessions")
        .select("*")
        .eq("id", req.params.id)
        .single();

      if (!session) return res.status(404).json({ error: "Call not found" });
      if (session.victim_id !== req.user!.id && session.counsellor_id !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { data: updated, error } = await supabaseAdmin
        .from("call_sessions")
        .update({
          status: "completed",
          transcript: body.transcript ?? session.transcript,
          duration_seconds: body.duration_seconds ?? session.duration_seconds,
          ended_at: new Date().toISOString(),
        })
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) return res.status(500).json({ error: "Failed to complete call" });

      const transcript = (body.transcript ?? session.transcript ?? "").trim();
      if (transcript) {
        const channel = session.call_type === "ai_voice" ? "ai_voice" : "chat";
        await createCheckinAndScore({
          caseId: session.case_id,
          victimId: session.victim_id,
          transcript,
          channel,
          io,
        });
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/bridge", requireAuth, requireRole("counsellor", "admin"), async (req, res, next) => {
    try {
      const { data: session } = await supabaseAdmin
        .from("call_sessions")
        .select("id, counsellor_id, call_type")
        .eq("id", req.params.id)
        .single();

      if (!session) return res.status(404).json({ error: "Call not found" });
      if (session.counsellor_id !== req.user!.id && req.user!.role !== "admin") {
        return res.status(403).json({ error: "Access denied" });
      }
      if (session.call_type !== "counsellor") {
        return res.status(400).json({ error: "Only counsellor calls can be bridged" });
      }
      if (!isExotelConfigured()) {
        return res.status(503).json({ error: "Exotel is not configured" });
      }

      const result = await bridgeCounsellorCall(session.id);
      if (!result) {
        return res.status(422).json({
          error: "Bridge failed — ensure victim and counsellor have phone numbers in their profiles",
        });
      }

      res.json({ call_sid: result.callSid, message: "Exotel is dialing counsellor, then victim" });
    } catch (err) {
      next(err);
    }
  });


  return router;
}
