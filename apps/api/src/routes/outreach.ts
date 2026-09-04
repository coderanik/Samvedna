import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { canAccessCase, fetchCaseForAccess, accessibleCaseIds } from "../lib/case-access";
import { auditMiddleware } from "../lib/audit";
import { safeQuery } from "../lib/db-safe";
import {
  getGoneQuietCases,
  markOutreachResponded,
  processDueOutreach,
  type OutreachRow,
} from "../lib/cadence-engine";
import type { Server as SocketServer } from "socket.io";

const NO_CASE = "00000000-0000-0000-0000-000000000000";

export function outreachRouter(io?: SocketServer) {
  const router = Router();

  /** Cases that have gone quiet — two or more misses, or silence past 2× cadence. */
  router.get(
    "/gone-quiet",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    async (req, res, next) => {
      try {
        const ids = await accessibleCaseIds(req.user!.role, req.user!.id);
        res.json(await getGoneQuietCases(ids));
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/due",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    async (req, res, next) => {
      try {
        const ids = await accessibleCaseIds(req.user!.role, req.user!.id);

        const { data, degraded } = await safeQuery<OutreachRow[]>("outreach_schedule:due_list", () => {
          let query = supabaseAdmin
            .from("outreach_schedule")
            .select("*, cases(case_number, case_type, district, cadence_tier)")
            .in("status", ["scheduled", "sent"])
            .lte("scheduled_for", new Date().toISOString())
            .order("scheduled_for", { ascending: true })
            .limit(200);
          if (ids) query = query.in("case_id", ids.length ? ids : [NO_CASE]);
          return query;
        });

        if (degraded) {
          return res.json({
            due: [],
            degraded: true,
            honesty: "Outreach schedule table is not available on this database yet.",
          });
        }

        res.json({ due: data ?? [], degraded: false });
      } catch (err) {
        next(err);
      }
    }
  );

  /** Demo fast-forward: runs one cadence tick immediately instead of waiting 60s. */
  router.post("/simulate-tick", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const result = await processDueOutreach(io);
      res.json({
        ...result,
        honesty:
          "Demo fast-forward — runs the same tick the 60s interval runs, marking due outreach sent and stale outreach missed.",
      });
    } catch (err) {
      next(err);
    }
  });

  router.get(
    "/case/:caseId",
    requireAuth,
    auditMiddleware("outreach_schedule_viewed", "outreach_schedule"),
    async (req, res, next) => {
      try {
        const caseRow = await fetchCaseForAccess(req.params.caseId);
        if (!caseRow) return res.status(404).json({ error: "Case not found" });
        if (!canAccessCase(req.user!.role, req.user!.id, caseRow)) {
          return res.status(403).json({ error: "Access denied" });
        }

        const { data, degraded } = await safeQuery<OutreachRow[]>("outreach_schedule:by_case", () =>
          supabaseAdmin
            .from("outreach_schedule")
            .select("*")
            .eq("case_id", req.params.caseId)
            .order("scheduled_for", { ascending: false })
            .limit(60)
        );

        if (degraded) return res.json([]);
        res.json(data ?? []);
      } catch (err) {
        next(err);
      }
    }
  );

  const scheduleSchema = z.object({
    case_id: z.string().uuid(),
    scheduled_for: z.string().datetime({ offset: true }),
    channel: z
      .enum(["chat", "sms", "ivrs", "helpline_callback", "app", "ai_voice"])
      .default("chat"),
    reason: z.string().min(1).max(500).optional(),
  });

  router.post(
    "/schedule",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    auditMiddleware("outreach_scheduled", "outreach_schedule"),
    async (req, res, next) => {
      try {
        const body = scheduleSchema.parse(req.body);

        const caseRow = await fetchCaseForAccess(body.case_id);
        if (!caseRow) return res.status(404).json({ error: "Case not found" });
        if (!canAccessCase(req.user!.role, req.user!.id, caseRow)) {
          return res.status(403).json({ error: "Access denied" });
        }

        const { data, degraded, error } = await safeQuery<OutreachRow>(
          "outreach_schedule:manual",
          () =>
            supabaseAdmin
              .from("outreach_schedule")
              .insert({
                case_id: body.case_id,
                scheduled_for: body.scheduled_for,
                channel: body.channel,
                status: "scheduled",
                reason: body.reason ?? "Manually scheduled by the care team",
                generated_by: "manual",
                attempt_count: 0,
              })
              .select()
              .single()
        );

        if (degraded) {
          return res
            .status(503)
            .json({ error: "Outreach schedule is not available on this database yet" });
        }
        if (!data) {
          return res.status(400).json({ error: error?.message ?? "Failed to schedule outreach" });
        }

        io?.to(`case:${body.case_id}`).emit("outreach_update", { type: "scheduled", outreach: data });
        res.status(201).json(data);
      } catch (err) {
        next(err);
      }
    }
  );

  const respondSchema = z.object({
    checkin_id: z.string().uuid().optional(),
  });

  router.post(
    "/:id/respond",
    requireAuth,
    auditMiddleware("outreach_responded", "outreach_schedule"),
    async (req, res, next) => {
      try {
        const body = respondSchema.parse(req.body ?? {});

        const { data: row, degraded } = await safeQuery<{ id: string; case_id: string }>(
          "outreach_schedule:fetch",
          () =>
            supabaseAdmin
              .from("outreach_schedule")
              .select("id, case_id")
              .eq("id", req.params.id)
              .single()
        );

        if (degraded) {
          return res
            .status(503)
            .json({ error: "Outreach schedule is not available on this database yet" });
        }
        if (!row) return res.status(404).json({ error: "Outreach not found" });

        const caseRow = await fetchCaseForAccess(row.case_id);
        if (!caseRow || !canAccessCase(req.user!.role, req.user!.id, caseRow)) {
          return res.status(403).json({ error: "Access denied" });
        }

        const updated = await markOutreachResponded(row.id, body.checkin_id ?? null, io);
        if (!updated) return res.status(500).json({ error: "Failed to record response" });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
