import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth, requireRole } from "../middleware/auth";
import { scheduleEventOutreach } from "../lib/cadence-engine";
import { getRedactionStats } from "../lib/redact";
import type { Server as SocketServer } from "socket.io";
import crypto from "crypto";

export function adminRouter(io?: SocketServer) {
  const router = Router();

  router.get("/stats", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("id, role");
      if (error) return res.status(500).json({ error: "Failed to fetch stats" });

      const list = profiles ?? [];
      const byRole = {
        victim: list.filter((p) => p.role === "victim").length,
        counsellor: list.filter((p) => p.role === "counsellor").length,
        official: list.filter((p) => p.role === "official").length,
        admin: list.filter((p) => p.role === "admin").length,
      };

      const { count: casesCount } = await supabaseAdmin
        .from("cases")
        .select("*", { count: "exact", head: true });

      const { count: openAlerts } = await supabaseAdmin
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .in("status", ["open", "acknowledged"]);

      const { count: unassignedCases } = await supabaseAdmin
        .from("cases")
        .select("*", { count: "exact", head: true })
        .is("assigned_counsellor_id", null);

      res.json({
        total_users: list.length,
        victims: byRole.victim,
        counsellors: byRole.counsellor,
        officials: byRole.official,
        admins: byRole.admin,
        cases: casesCount ?? 0,
        unassigned_cases: unassignedCases ?? 0,
        open_alerts: openAlerts ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/users", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: "Failed to fetch users" });
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    full_name: z.string().min(2),
    role: z.enum(["counsellor", "official", "victim"]),
    preferred_language: z.enum(["en", "hi", "ta"]).default("en"),
    phone_number: z.string().optional().nullable(),
  });

  /** Admin creates counsellor / official / victim accounts. */
  router.post("/users", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      const body = createUserSchema.parse(req.body);

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: body.email.trim().toLowerCase(),
        password: body.password,
        email_confirm: true,
        user_metadata: {
          role: body.role,
          full_name: body.full_name.trim(),
          preferred_language: body.preferred_language,
          phone_number: body.phone_number ?? null,
        },
      });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      const userId = data.user!.id;
      await supabaseAdmin.from("profiles").upsert({
        id: userId,
        role: body.role,
        full_name: body.full_name.trim(),
        preferred_language: body.preferred_language,
        phone_number: body.phone_number ?? null,
      });

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      res.status(201).json(profile);
    } catch (err) {
      next(err);
    }
  });

  const assignSchema = z.object({
    assigned_counsellor_id: z.string().uuid().optional().nullable(),
    assigned_official_id: z.string().uuid().optional().nullable(),
  });

  router.patch("/cases/:id/assign", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      const body = assignSchema.parse(req.body);
      const { data, error } = await supabaseAdmin
        .from("cases")
        .update(body)
        .eq("id", req.params.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: "Failed to update assignment" });
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  const tokenSchema = z.object({ case_id: z.string().uuid() });

  router.post(
    "/onboarding-token",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    async (req, res, next) => {
      try {
        const body = tokenSchema.parse(req.body);
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const { data, error } = await supabaseAdmin
          .from("onboarding_tokens")
          .insert({
            token,
            case_id: body.case_id,
            created_by: req.user!.id,
            expires_at: expiresAt.toISOString(),
          })
          .select()
          .single();

        if (error) return res.status(500).json({ error: "Failed to create token" });
        res.status(201).json(data);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get("/onboarding/:token", async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("onboarding_tokens")
        .select("*, cases(case_number, case_type)")
        .eq("token", req.params.token)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (error || !data) return res.status(404).json({ error: "Invalid or expired token" });
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  const simulateBailSchema = z.object({
    case_id: z.string().uuid(),
  });

  /**
   * POST /admin/simulate-bail — Demo: grants bail to accused, schedules event outreach,
   * recommends witness protection if available, records timeline event.
   */
  router.post("/simulate-bail", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      const body = simulateBailSchema.parse(req.body);
      const today = new Date().toISOString().split("T")[0];

      // Update case with bail granted
      const { data: caseRow, error: updateError } = await supabaseAdmin
        .from("cases")
        .update({
          accused_bail_status: "granted",
          bail_granted_date: today,
        })
        .eq("id", body.case_id)
        .select(
          "id, case_number, status, next_hearing_date, relief_due_date, relief_amount_sanctioned, relief_amount_disbursed, assigned_counsellor_id"
        )
        .single();

      if (updateError || !caseRow) {
        return res.status(404).json({ error: "Case not found or update failed" });
      }

      // Schedule event outreach if cadence engine is available
      const outreachScheduled = await scheduleEventOutreach(caseRow, io);

      // Record timeline event
      await supabaseAdmin
        .from("case_timeline_events")
        .insert({
          case_id: body.case_id,
          event_type: "bail_granted",
          description: `Demo: Accused released on bail as of ${today} — witness protection and safety checks scheduled`,
          created_by: caseRow.assigned_counsellor_id ?? null,
        })
        .select("id");

      // Recommend POA_WITNESS_PROTECT intervention if catalog exists
      // (We won't fail if intervention_catalog isn't available)
      const { data: catalogEntry } = await supabaseAdmin
        .from("intervention_catalog")
        .select("*")
        .eq("code", "POA_WITNESS_PROTECT")
        .maybeSingle();

      let interventionRecommended = false;
      if (catalogEntry) {
        const { error: recError } = await supabaseAdmin
          .from("support_recommendations")
          .insert({
            case_id: body.case_id,
            recommendation_type: "POA_WITNESS_PROTECT",
            priority: "high",
            reason: "Accused released on bail — witness protection measures recommended",
            status: "pending",
            created_by: caseRow.assigned_counsellor_id ?? null,
          });
        interventionRecommended = !recError;
      }

      res.json({
        case_id: body.case_id,
        case_number: caseRow.case_number,
        accused_bail_status: "granted",
        bail_granted_date: today,
        outreach_scheduled: outreachScheduled.length,
        intervention_recommended: interventionRecommended ? "POA_WITNESS_PROTECT" : null,
        honesty:
          "Demo fast-forward: bail granted, safety outreach scheduled, witness protection recommended if catalog available.",
      });
    } catch (err) {
      next(err);
    }
  });

  /** Process-level counter of PII stripped before any transcript reached an LLM. */
  router.get("/redaction-stats", requireAuth, requireRole("admin"), (_req, res) => {
    const s = getRedactionStats();
    res.json({
      ...s,
      placeholders: ["[NAME_n]", "[PHONE]", "[EMAIL]", "[AADHAAR]", "[VILLAGE]", "[ID]"],
      honesty:
        "Counted in-process and reset on API restart. The placeholder-to-original mapping is held locally for the duration of a single call and is never sent or stored.",
    });
  });

  /**
   * GET /admin/model-health — Check ML service reachability, redaction stats, and forecast honesty note.
   */
  router.get("/model-health", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const redactionStats = getRedactionStats();

      // Check ML service health (Gemini endpoint)
      let geminiReachable = false;
      let geminiError: string | null = null;
      try {
        const mlBaseUrl = process.env.ML_SERVICE_URL || "http://localhost:5000";
        const healthUrl = `${mlBaseUrl}/health`;
        const response = await fetch(healthUrl, { method: "GET", signal: AbortSignal.timeout(3000) });
        geminiReachable = response.ok;
        if (!response.ok) geminiError = `HTTP ${response.status}`;
      } catch (err) {
        geminiError = err instanceof Error ? err.message : String(err);
      }

      res.json({
        ml_service: {
          gemini_reachable: geminiReachable,
          error: geminiError,
          endpoint: process.env.ML_SERVICE_URL || "http://localhost:5000",
        },
        redaction: {
          calls: redactionStats.calls,
          entities_redacted: redactionStats.entities_redacted,
          by_type: redactionStats.by_type,
          last_redaction_at: redactionStats.last_redaction_at,
        },
        forecast_honesty:
          "Distress forecasts are extrapolated from recent trends and not yet trained on longitudinal outcome data. Treat as exploratory, not predictive.",
        honesty: "Model health snapshot at query time. Redaction stats reset on API restart.",
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
