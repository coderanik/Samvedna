import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import { summariseCallTranscript } from "../lib/call-summary";
import {
  isTwilioConfigured,
  isTwilioLive,
  placeTwilioOutboundCall,
} from "../lib/twilio";
import { finalizeTwilioInstantCall } from "./twilio-webhooks";
import {
  clearLiveTwilioCall,
  getLiveTwilioCall,
  registerLiveTwilioCall,
  updateLiveTwilioCall,
} from "../lib/twilio-call-state";
import { randomUUID } from "crypto";
import type { Server as SocketServer } from "socket.io";

export function instantCallsRouter(io: SocketServer) {
  const router = Router();

  router.post("/start", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const body = z
        .object({
          mode: z.enum(["auto", "browser", "twilio"]).default("auto"),
        })
        .parse(req.body ?? {});

      const userId = req.user!.id;

      const { data: caseRow } = await supabaseAdmin
        .from("cases")
        .select("id, case_number")
        .eq("victim_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!caseRow) return res.status(404).json({ error: "No case found for your account" });

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("phone_number, preferred_language, full_name")
        .eq("id", userId)
        .single();

      const { data: session, error: sessionErr } = await supabaseAdmin
        .from("call_sessions")
        .insert({
          case_id: caseRow.id,
          victim_id: userId,
          call_type: "ai_voice",
          status: "requested",
          risk_level_at_call: "low",
          distress_score_at_call: null,
        })
        .select()
        .single();

      if (sessionErr || !session) {
        return res.status(500).json({ error: "Failed to start call session" });
      }

      // Prefer DB table; fall back to in-memory registry when migration missing
      let instant: {
        id: string;
        user_id: string;
        case_id: string;
        call_session_id: string;
        status: string;
        twilio_call_sid?: string | null;
      } | null = null;
      let usingMemory = false;

      {
        const inserted = await supabaseAdmin
          .from("instant_calls")
          .insert({
            user_id: userId,
            case_id: caseRow.id,
            call_session_id: session.id,
            status: "requested",
          })
          .select()
          .single();

        if (inserted.data) {
          instant = inserted.data;
        } else {
          usingMemory = true;
          const id = randomUUID();
          registerLiveTwilioCall({
            id,
            userId,
            caseId: caseRow.id,
            callSessionId: session.id,
            preferredLanguage: profile?.preferred_language ?? "en",
            transcript: "",
            status: "requested",
            createdAt: new Date().toISOString(),
          });
          instant = {
            id,
            user_id: userId,
            case_id: caseRow.id,
            call_session_id: session.id,
            status: "requested",
          };
          console.warn(
            "[instant-call] instant_calls table missing — using in-memory tracking. Apply victim_dashboard migration when you can."
          );
        }
      }

      const wantTwilio =
        body.mode === "twilio" || (body.mode === "auto" && isTwilioLive());
      const canTwilio =
        wantTwilio && isTwilioConfigured() && Boolean(profile?.phone_number?.trim());

      if (canTwilio && isTwilioLive()) {
        try {
          const result = await placeTwilioOutboundCall({
            toPhone: profile!.phone_number!,
            instantCallId: instant!.id,
          });

          if (!usingMemory) {
            await supabaseAdmin
              .from("instant_calls")
              .update({ twilio_call_sid: result.callSid, status: "ringing" })
              .eq("id", instant!.id);
          } else {
            updateLiveTwilioCall(instant!.id, {
              twilioCallSid: result.callSid,
              status: "ringing",
            });
          }

          await supabaseAdmin
            .from("call_sessions")
            .update({ status: "ringing" })
            .eq("id", session.id);

          return res.status(201).json({
            instant_call: {
              ...instant,
              twilio_call_sid: result.callSid,
              status: "ringing",
            },
            call_session: { ...session, status: "ringing" },
            mode: "twilio",
            to: result.to,
            honesty: usingMemory
              ? "LIVE Twilio (in-memory tracking until instant_calls migration is applied)."
              : "LIVE — Twilio Conversational Voice (Mann-Mitra gather loop).",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[instant-call] Twilio failed:", msg);
          if (body.mode === "twilio") {
            return res.status(502).json({
              error: `Twilio call failed: ${msg}`,
              hint: "Check TWILIO_* credentials, FROM number, victim phone_number, and TWILIO_WEBHOOK_BASE_URL.",
            });
          }
        }
      } else if (body.mode === "twilio") {
        return res.status(503).json({
          error: !isTwilioConfigured()
            ? "Twilio is not configured"
            : !isTwilioLive()
              ? "Twilio needs TWILIO_WEBHOOK_BASE_URL as public HTTPS (e.g. ngrok http 4000)"
              : "Add a phone number on your profile to receive the call",
          configured: isTwilioConfigured(),
          live: isTwilioLive(),
          has_phone: Boolean(profile?.phone_number?.trim()),
        });
      }

      if (!usingMemory) {
        await supabaseAdmin
          .from("instant_calls")
          .update({ status: "in_progress" })
          .eq("id", instant!.id);
      } else {
        updateLiveTwilioCall(instant!.id, { status: "in_progress" });
      }

      res.status(201).json({
        instant_call: { ...instant, status: "in_progress" },
        call_session: session,
        mode: "browser",
        preferred_language: profile?.preferred_language ?? "en",
        honesty: isTwilioLive()
          ? "Browser Mann-Mitra voice. Twilio LIVE is also available."
          : "LIVE in-browser Mann-Mitra. Set TWILIO_WEBHOOK_BASE_URL for phone calls.",
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/complete", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const body = z
        .object({
          transcript: z.string().optional(),
          duration_seconds: z.number().int().optional(),
        })
        .parse(req.body);

      const userId = req.user!.id;
      const live = getLiveTwilioCall(req.params.id);

      if (live) {
        if (live.userId !== userId) return res.status(403).json({ error: "Access denied" });
        await finalizeTwilioInstantCall(live.id, io, {
          durationSeconds: body.duration_seconds,
        });
        const done = getLiveTwilioCall(live.id);
        clearLiveTwilioCall(live.id);
        return res.json({
          id: live.id,
          status: "completed",
          summary: done?.transcript ? undefined : null,
          transcript: body.transcript ?? live.transcript,
        });
      }

      const { data: instant } = await supabaseAdmin
        .from("instant_calls")
        .select("*")
        .eq("id", req.params.id)
        .maybeSingle();

      if (!instant) return res.status(404).json({ error: "Instant call not found" });
      if (instant.user_id !== userId) return res.status(403).json({ error: "Access denied" });

      if (instant.twilio_call_sid && instant.status !== "completed") {
        await finalizeTwilioInstantCall(instant.id, io, {
          durationSeconds: body.duration_seconds,
        });
        const { data: refreshed } = await supabaseAdmin
          .from("instant_calls")
          .select("*")
          .eq("id", instant.id)
          .single();
        return res.json(refreshed);
      }

      if (instant.status === "completed") return res.json(instant);

      const transcript = (body.transcript ?? instant.transcript ?? "").trim();
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("preferred_language")
        .eq("id", userId)
        .single();

      const summary = await summariseCallTranscript(
        transcript,
        profile?.preferred_language ?? "en"
      );

      let distressScoreId: string | null = null;
      if (transcript && instant.case_id) {
        const scored = await createCheckinAndScore({
          caseId: instant.case_id,
          victimId: userId,
          transcript,
          channel: "ai_voice",
          io,
        });
        distressScoreId = scored.distressScore?.id ?? null;
      }

      const { data: updated, error } = await supabaseAdmin
        .from("instant_calls")
        .update({
          transcript: transcript || instant.transcript,
          summary,
          duration_seconds: body.duration_seconds ?? instant.duration_seconds,
          status: "completed",
          distress_score_id: distressScoreId,
        })
        .eq("id", instant.id)
        .select()
        .single();

      if (error) return res.status(500).json({ error: "Failed to complete instant call" });

      if (instant.call_session_id) {
        await supabaseAdmin
          .from("call_sessions")
          .update({
            status: "completed",
            transcript: transcript || null,
            duration_seconds: body.duration_seconds,
            ended_at: new Date().toISOString(),
          })
          .eq("id", instant.call_session_id);
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.get("/capabilities", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("phone_number")
        .eq("id", req.user!.id)
        .single();

      const configured = isTwilioConfigured();
      const live = isTwilioLive();
      const hasPhone = Boolean(profile?.phone_number?.trim());

      res.json({
        browser_voice: true,
        twilio_outbound: configured,
        twilio_live: live && hasPhone,
        has_phone: hasPhone,
        preferred_mode: live && hasPhone ? "twilio" : "browser",
        label: live && hasPhone ? "LIVE" : configured ? "NEEDS_PHONE_OR_WEBHOOK" : "ARCHITECTED",
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("instant_calls")
        .select("id, summary, created_at, duration_seconds, status, twilio_call_sid")
        .eq("user_id", req.user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return res.json([]);
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const live = getLiveTwilioCall(req.params.id);
      if (live) {
        if (live.userId !== req.user!.id) return res.status(403).json({ error: "Access denied" });
        return res.json({
          id: live.id,
          summary: null,
          transcript: live.transcript || null,
          created_at: live.createdAt,
          duration_seconds: null,
          status: live.status,
          twilio_call_sid: live.twilioCallSid ?? null,
          distress_score_id: null,
        });
      }

      const { data, error } = await supabaseAdmin
        .from("instant_calls")
        .select(
          "id, summary, transcript, created_at, duration_seconds, status, twilio_call_sid, distress_score_id"
        )
        .eq("id", req.params.id)
        .eq("user_id", req.user!.id)
        .maybeSingle();

      if (error || !data) return res.status(404).json({ error: "Not found" });
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
