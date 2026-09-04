import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";

async function loadProfile(userId: string) {
  const extended = await supabaseAdmin
    .from("profiles")
    .select(
      "id, full_name, preferred_language, phone_number, case_reference, photo_url, bio, instant_call_count, consultant_meet_count, created_at"
    )
    .eq("id", userId)
    .maybeSingle();

  if (extended.data) return extended.data;

  const basic = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, preferred_language, phone_number, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (!basic.data) return null;

  return {
    ...basic.data,
    case_reference: null,
    photo_url: null,
    bio: null,
    instant_call_count: 0,
    consultant_meet_count: 0,
  };
}

export function victimProfileRouter() {
  const router = Router();

  router.get("/", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;

      const profile = await loadProfile(userId);
      if (!profile) return res.status(404).json({ error: "Profile not found" });

      const { data: cases } = await supabaseAdmin
        .from("cases")
        .select(
          "id, case_number, case_type, status, district, state, created_at, assigned_counsellor_id"
        )
        .eq("victim_id", userId)
        .order("created_at", { ascending: false });

      const caseIds = (cases ?? []).map((c) => c.id);

      let scoreHistory: unknown[] = [];
      if (caseIds.length) {
        const withSource = await supabaseAdmin
          .from("distress_scores")
          .select("id, score, source, created_at, risk_level")
          .in("case_id", caseIds)
          .order("created_at", { ascending: false })
          .limit(100);
        if (withSource.data) {
          scoreHistory = withSource.data;
        } else {
          const basic = await supabaseAdmin
            .from("distress_scores")
            .select("id, score, created_at, risk_level")
            .in("case_id", caseIds)
            .order("created_at", { ascending: false })
            .limit(100);
          scoreHistory = (basic.data ?? []).map((s) => ({ ...s, source: null }));
        }
      }

      let meetReports: unknown[] = [];
      {
        const { data, error } = await supabaseAdmin
          .from("consultant_meets")
          .select(
            `
            id, status, scheduled_at, report, recommendations, created_at,
            consultant:consultants(name, specialization)
          `
          )
          .eq("user_id", userId)
          .order("scheduled_at", { ascending: false });
        if (!error && data) meetReports = data;
      }

      let calls: unknown[] = [];
      {
        const { data, error } = await supabaseAdmin
          .from("instant_calls")
          .select("id, summary, created_at, duration_seconds, status, twilio_call_sid")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!error && data) calls = data;
      }

      let tags: unknown[] = [];
      {
        const { data, error } = await supabaseAdmin
          .from("user_problem_tags")
          .select("tag, last_seen_at")
          .eq("user_id", userId);
        if (!error && data) tags = data;
      }

      res.json({
        profile,
        cases: cases ?? [],
        score_history: scoreHistory,
        meet_reports: meetReports,
        instant_call_history: calls,
        tags,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const body = z
        .object({
          full_name: z.string().min(1).max(120).optional(),
          phone_number: z.string().max(20).nullable().optional(),
          preferred_language: z.string().max(10).optional(),
          case_reference: z.string().max(80).nullable().optional(),
          bio: z.string().max(500).nullable().optional(),
        })
        .parse(req.body);

      // Only send columns that exist when migration isn't applied
      const core: Record<string, unknown> = {};
      if (body.full_name !== undefined) core.full_name = body.full_name;
      if (body.phone_number !== undefined) core.phone_number = body.phone_number;
      if (body.preferred_language !== undefined) core.preferred_language = body.preferred_language;

      const extended = {
        ...core,
        ...(body.case_reference !== undefined ? { case_reference: body.case_reference } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
      };

      let result = await supabaseAdmin
        .from("profiles")
        .update(extended)
        .eq("id", req.user!.id)
        .select("id, full_name, preferred_language, phone_number, case_reference, photo_url, bio")
        .maybeSingle();

      if (result.error || !result.data) {
        result = await supabaseAdmin
          .from("profiles")
          .update(core)
          .eq("id", req.user!.id)
          .select("id, full_name, preferred_language, phone_number")
          .maybeSingle();
        if (result.data) {
          result = {
            ...result,
            data: {
              ...result.data,
              case_reference: body.case_reference ?? null,
              photo_url: null,
              bio: body.bio ?? null,
            },
          };
        }
      }

      if (!result.data) {
        return res.status(500).json({
          error: result.error?.message ?? "Failed to update profile",
        });
      }
      res.json(result.data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
