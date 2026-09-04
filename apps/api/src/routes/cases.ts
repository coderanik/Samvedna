import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { canAccessCase } from "../lib/case-access";
import { auditMiddleware } from "../lib/audit";

export function casesRouter() {
  const router = Router();

  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const user = req.user!;
      let query = supabaseAdmin.from("cases").select(`
        *,
        victim:profiles!cases_victim_id_fkey(id, full_name, preferred_language),
        assigned_counsellor:profiles!cases_assigned_counsellor_id_fkey(id, full_name),
        assigned_official:profiles!cases_assigned_official_id_fkey(id, full_name)
      `);

      if (user.role === "victim") {
        query = query.eq("victim_id", user.id);
      } else if (user.role === "counsellor") {
        query = query.eq("assigned_counsellor_id", user.id);
      } else if (user.role === "official") {
        query = query.eq("assigned_official_id", user.id);
      }
      // admin sees all

      const { data: cases, error } = await query.order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: "Failed to fetch cases" });

      const caseIds = (cases ?? []).map((c) => c.id);
      const { data: latestScores } = await supabaseAdmin
        .from("distress_scores")
        .select("*")
        .in("case_id", caseIds)
        .order("created_at", { ascending: false });

      const scoreMap = new Map<string, NonNullable<typeof latestScores>[number]>();
      for (const s of latestScores ?? []) {
        if (!scoreMap.has(s.case_id)) scoreMap.set(s.case_id, s);
      }

      const enriched = (cases ?? []).map((c) => ({
        ...c,
        latest_score: scoreMap.get(c.id) ?? null,
      }));

      res.json(enriched);
    } catch (err) {
      next(err);
    }
  });

  // GET /cases/:caseId/scores/:scoreId/explain is served by explainRouter,
  // which is mounted on /cases ahead of this router.

  const timelineAudit = auditMiddleware("case_timeline_viewed", "case");

  router.get("/:id/timeline", requireAuth, timelineAudit, async (req, res, next) => {
    try {
      const caseId = req.params.id;
      const user = req.user!;

      const { data: caseRow, error } = await supabaseAdmin
        .from("cases")
        .select(`
          *,
          victim:profiles!cases_victim_id_fkey(*),
          assigned_counsellor:profiles!cases_assigned_counsellor_id_fkey(*),
          assigned_official:profiles!cases_assigned_official_id_fkey(*)
        `)
        .eq("id", caseId)
        .single();

      if (error || !caseRow) return res.status(404).json({ error: "Case not found" });

      if (!canAccessCase(user.role, user.id, caseRow)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const [checkinsRes, alertsRes, notesRes, supportRes, eventsRes] = await Promise.all([
        supabaseAdmin
          .from("checkins")
          .select("*, distress_scores(*)")
          .eq("case_id", caseId)
          .order("created_at", { ascending: true }),
        supabaseAdmin.from("alerts").select("*").eq("case_id", caseId).order("created_at"),
        supabaseAdmin
          .from("intervention_notes")
          .select("*, counsellor:profiles!intervention_notes_counsellor_id_fkey(full_name)")
          .eq("case_id", caseId)
          .order("created_at"),
        supabaseAdmin.from("support_recommendations").select("*").eq("case_id", caseId).order("created_at"),
        supabaseAdmin.from("case_timeline_events").select("*").eq("case_id", caseId).order("created_at"),
      ]);

      const checkins = (checkinsRes.data ?? []).map((c) => {
        const scores = c.distress_scores as unknown as Array<Record<string, unknown>>;
        const { distress_scores: _, ...rest } = c;
        return { ...rest, distress_score: scores?.[0] ?? null };
      });

      res.json({
        case: caseRow,
        checkins,
        alerts: alertsRes.data ?? [],
        intervention_notes: notesRes.data ?? [],
        support_recommendations: supportRes.data ?? [],
        timeline_events: eventsRes.data ?? [],
      });
    } catch (err) {
      next(err);
    }
  });

  const noteSchema = z.object({ note: z.string().min(1).max(5000) });

  router.post("/:id/notes", requireAuth, async (req, res, next) => {
    try {
      if (req.user!.role !== "counsellor") {
        return res.status(403).json({ error: "Only counsellors can add notes" });
      }

      const body = noteSchema.parse(req.body);
      const caseId = req.params.id;

      const { data: caseRow } = await supabaseAdmin
        .from("cases")
        .select("assigned_counsellor_id")
        .eq("id", caseId)
        .single();

      if (!caseRow || caseRow.assigned_counsellor_id !== req.user!.id) {
        return res.status(403).json({ error: "Not assigned to this case" });
      }

      const { data, error } = await supabaseAdmin
        .from("intervention_notes")
        .insert({
          case_id: caseId,
          counsellor_id: req.user!.id,
          note: body.note,
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: "Failed to save note" });

      await supabaseAdmin.from("case_timeline_events").insert({
        case_id: caseId,
        event_type: "intervention_note",
        description: "Counsellor added an intervention note",
        created_by: req.user!.id,
      });

      res.status(201).json(data);
    } catch (err) {
      next(err);
    }
  });

  const supportSchema = z.object({
    type: z.enum(["counselling", "medical", "legal", "financial", "protection", "rehabilitation"]),
    description: z.string().min(1).max(2000),
    alert_id: z.string().uuid().optional(),
  });

  router.post("/:id/support", requireAuth, async (req, res, next) => {
    try {
      if (!["counsellor", "official", "admin"].includes(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const body = supportSchema.parse(req.body);
      const { data, error } = await supabaseAdmin
        .from("support_recommendations")
        .insert({
          case_id: req.params.id,
          alert_id: body.alert_id ?? null,
          type: body.type,
          description: body.description,
          status: "suggested",
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: "Failed to create recommendation" });
      res.status(201).json(data);
    } catch (err) {
      next(err);
    }
  });

  const supportStatusSchema = z.object({
    status: z.enum(["suggested", "in_progress", "completed"]),
  });

  router.patch(
    "/:id/support/:supportId",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    auditMiddleware("support_recommendation_updated", "support_recommendation"),
    async (req, res, next) => {
      try {
        const body = supportStatusSchema.parse(req.body);

        const { data: caseRow } = await supabaseAdmin
          .from("cases")
          .select("victim_id, assigned_counsellor_id, assigned_official_id")
          .eq("id", req.params.id)
          .maybeSingle();
        if (!caseRow) return res.status(404).json({ error: "Case not found" });
        if (!canAccessCase(req.user!.role, req.user!.id, caseRow)) {
          return res.status(403).json({ error: "Not assigned to this case" });
        }

        const updates: Record<string, unknown> = { status: body.status };
        // A completed action stops the statutory SLA clock.
        if (body.status === "completed") updates.sla_breached = false;

        let { data, error } = await supabaseAdmin
          .from("support_recommendations")
          .update(updates)
          .eq("id", req.params.supportId)
          .eq("case_id", req.params.id)
          .select()
          .single();

        if (error && "sla_breached" in updates) {
          ({ data, error } = await supabaseAdmin
            .from("support_recommendations")
            .update({ status: body.status })
            .eq("id", req.params.supportId)
            .eq("case_id", req.params.id)
            .select()
            .single());
        }

        if (error) return res.status(500).json({ error: "Failed to update recommendation" });
        res.json(data);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
