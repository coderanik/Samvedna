import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";

export function victimDashboardRouter() {
  const router = Router();

  router.get("/", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;

      let profile: Record<string, unknown> | null = null;
      {
        const extended = await supabaseAdmin
          .from("profiles")
          .select(
            "id, full_name, preferred_language, phone_number, instant_call_count, consultant_meet_count, case_reference, photo_url"
          )
          .eq("id", userId)
          .maybeSingle();

        if (extended.data) {
          profile = extended.data;
        } else {
          const basic = await supabaseAdmin
            .from("profiles")
            .select("id, full_name, preferred_language, phone_number")
            .eq("id", userId)
            .maybeSingle();
          profile = basic.data
            ? {
                ...basic.data,
                instant_call_count: 0,
                consultant_meet_count: 0,
                case_reference: null,
                photo_url: null,
              }
            : null;
        }
      }

      if (!profile) return res.status(404).json({ error: "Profile not found" });

      const fullName = String(profile.full_name ?? "there");
      const firstName = fullName.split(/\s+/)[0];
      const preferredLanguage = String(profile.preferred_language ?? "en");

      const { data: cases } = await supabaseAdmin
        .from("cases")
        .select("id, case_number, status, district, state")
        .eq("victim_id", userId)
        .order("created_at", { ascending: false });

      const caseIds = (cases ?? []).map((c) => c.id);

      let scores: Array<{
        id: string;
        score: number;
        source: string | null;
        created_at: string;
      }> = [];

      if (caseIds.length) {
        const withSource = await supabaseAdmin
          .from("distress_scores")
          .select("id, score, source, created_at")
          .in("case_id", caseIds)
          .order("created_at", { ascending: false })
          .limit(30);
        if (withSource.data) {
          scores = withSource.data;
        } else {
          const basicScores = await supabaseAdmin
            .from("distress_scores")
            .select("id, score, created_at")
            .in("case_id", caseIds)
            .order("created_at", { ascending: false })
            .limit(30);
          scores = (basicScores.data ?? []).map((s) => ({ ...s, source: null }));
        }
      }

      const latest = scores[0] ?? null;
      const trend = [...scores].reverse().map((s) => ({
        score: s.score,
        at: s.created_at,
        source: s.source,
      }));

      let lastCall: {
        id: string;
        summary: string | null;
        created_at: string;
        duration_seconds: number | null;
      } | null = null;
      {
        const { data } = await supabaseAdmin
          .from("instant_calls")
          .select("id, summary, created_at, duration_seconds, status")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) lastCall = data;
      }

      let instantCallCount = Number(profile.instant_call_count ?? 0) || 0;
      let meetCount = Number(profile.consultant_meet_count ?? 0) || 0;

      if (instantCallCount === 0) {
        const { count, error } = await supabaseAdmin
          .from("instant_calls")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        if (!error) instantCallCount = count ?? 0;
      }
      if (meetCount === 0) {
        const { count, error } = await supabaseAdmin
          .from("consultant_meets")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("status", ["scheduled", "completed"]);
        if (!error) meetCount = count ?? 0;
      }

      res.json({
        welcome: {
          first_name: firstName,
          full_name: fullName,
          preferred_language: preferredLanguage,
        },
        summary: {
          instant_calls_made: instantCallCount,
          consultant_meets: meetCount,
          latest_score: latest
            ? {
                id: latest.id,
                score: latest.score,
                source: latest.source,
                created_at: latest.created_at,
              }
            : null,
          score_trend: trend,
        },
        last_call_summary: lastCall
          ? {
              id: lastCall.id,
              summary: lastCall.summary,
              created_at: lastCall.created_at,
              duration_seconds: lastCall.duration_seconds,
            }
          : null,
        case: cases?.[0] ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
