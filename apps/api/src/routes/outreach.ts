import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { processDueOutreach } from "../lib/cadence-engine";

export function outreachRouter() {
  const router = Router();

  router.get("/case/:caseId", requireAuth, async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("outreach_schedule")
        .select("*")
        .eq("case_id", req.params.caseId)
        .order("scheduled_for", { ascending: false })
        .limit(40);
      if (error) return res.status(500).json({ error: error.message });
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  router.get("/gone-quiet", requireAuth, requireRole("counsellor", "admin", "official"), async (_req, res, next) => {
    try {
      const { data: missed } = await supabaseAdmin
        .from("outreach_schedule")
        .select("case_id")
        .eq("status", "missed");
      const counts = new Map<string, number>();
      for (const r of missed ?? []) {
        counts.set(r.case_id, (counts.get(r.case_id) ?? 0) + 1);
      }
      const quietIds = [...counts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
      if (!quietIds.length) return res.json([]);

      const { data: cases } = await supabaseAdmin
        .from("cases")
        .select("id, case_number, case_type, status, district, cadence_tier, last_contact_at, victim:profiles!cases_victim_id_fkey(full_name)")
        .in("id", quietIds);

      res.json(
        (cases ?? []).map((c) => ({
          ...c,
          missed_count: counts.get(c.id) ?? 0,
          honesty: "LIVE disengagement signal from missed outreach schedule",
        }))
      );
    } catch (err) {
      next(err);
    }
  });

  router.post("/simulate-tick", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const result = await processDueOutreach();
      res.json({
        ...result,
        honesty: "Demo fast-forward — marks due outreach as sent/missed without waiting.",
      });
    } catch (err) {
      next(err);
    }
  });

  const scheduleSchema = z.object({
    case_id: z.string().uuid(),
    scheduled_for: z.string(),
    reason: z.string().optional(),
  });

  router.post("/schedule", requireAuth, requireRole("counsellor", "admin", "official"), async (req, res, next) => {
    try {
      const body = scheduleSchema.parse(req.body);
      const { data, error } = await supabaseAdmin
        .from("outreach_schedule")
        .insert({
          case_id: body.case_id,
          scheduled_for: body.scheduled_for,
          channel: "chat",
          status: "scheduled",
          reason: body.reason ?? "Manual schedule",
          generated_by: "manual",
        })
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      res.status(201).json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
