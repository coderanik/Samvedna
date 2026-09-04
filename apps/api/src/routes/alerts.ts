import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { scheduleRelapseCheck } from "../lib/cadence-engine";
import { recordAudit } from "../lib/audit";
import type { Server as SocketServer } from "socket.io";

export function alertsRouter(io?: SocketServer) {
  const router = Router();

  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const user = req.user!;
      let query = supabaseAdmin
        .from("alerts")
        .select(`
          *,
          case:cases(case_number, district, state, victim:profiles!cases_victim_id_fkey(full_name))
        `)
        .order("created_at", { ascending: false });

      // Alert data is care-team-only. A victim gets an empty list rather than a
      // 403, so their client never has to distinguish "none" from "forbidden".
      if (user.role === "victim") {
        return res.json([]);
      } else if (user.role === "counsellor") {
        query = query.eq("assigned_to", user.id);
      } else if (user.role === "official") {
        const { data: officialCases } = await supabaseAdmin
          .from("cases")
          .select("id")
          .eq("assigned_official_id", user.id);
        const caseIds = (officialCases ?? []).map((c) => c.id);
        query = query.in("case_id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"]);
      }

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: "Failed to fetch alerts" });
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  const updateSchema = z.object({
    status: z.enum(["open", "acknowledged", "resolved"]),
  });

  router.patch("/:id", requireAuth, async (req, res, next) => {
    try {
      if (req.user!.role === "victim") {
        return res.status(403).json({ error: "Access denied" });
      }

      const body = updateSchema.parse(req.body);
      const updates: Record<string, unknown> = { status: body.status };
      if (body.status === "resolved") {
        updates.resolved_at = new Date().toISOString();
      }

      const { data: alert } = await supabaseAdmin
        .from("alerts")
        .select("*, cases(assigned_counsellor_id, assigned_official_id)")
        .eq("id", req.params.id)
        .single();

      if (!alert) return res.status(404).json({ error: "Alert not found" });

      const caseData = alert.cases as {
        assigned_counsellor_id: string | null;
        assigned_official_id: string | null;
      };
      const userId = req.user!.id;
      const canUpdate =
        req.user!.role === "admin" ||
        alert.assigned_to === userId ||
        caseData.assigned_official_id === userId;

      if (!canUpdate) return res.status(403).json({ error: "Access denied" });

      const { data, error } = await supabaseAdmin
        .from("alerts")
        .update(updates)
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) return res.status(500).json({ error: "Failed to update alert" });

      // Resolution is not the end of the story — book a relapse check a week out.
      if (body.status === "resolved") {
        try {
          await scheduleRelapseCheck(alert.case_id, alert.id, io);
        } catch (e) {
          console.warn("[alerts] relapse check not scheduled", e instanceof Error ? e.message : e);
        }
      }

      await recordAudit({
        actorId: userId,
        actorRole: req.user!.role,
        action: `alert_${body.status}`,
        resourceType: "alert",
        resourceId: alert.id,
        caseId: alert.case_id,
        purpose: "care team acting on a distress alert",
        ip: req.ip,
        metadata: { from: alert.status, to: body.status },
      });

      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
