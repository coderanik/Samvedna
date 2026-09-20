import multer from "multer";
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { canAccessCase } from "../lib/case-access";
import { forecastDistress, scoreVoice } from "../lib/ml-client";
import { persistEmotionSignal, analyseEmotionFromText } from "../lib/emotion-escalation";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function baselineForProsody(row: Record<string, unknown> | null) {
  if (!row || Number(row.sample_count ?? 0) < 1) return undefined;
  return {
    sample_count: Number(row.sample_count ?? 0),
    f0_mean_mean: Number(row.f0_mean ?? 180),
    f0_mean_std: Number(row.f0_std ?? 25) || 25,
    f0_std_mean: Number(row.f0_std ?? 25),
    f0_std_std: 8,
    jitter_mean: Number(row.jitter_mean ?? 0.8),
    jitter_std: 0.35,
    shimmer_mean: Number(row.shimmer_mean ?? 6),
    shimmer_std: 2,
    hnr_mean: Number(row.hnr_mean ?? 12),
    hnr_std: 3.5,
    pause_ratio_mean: Number(row.pause_ratio_mean ?? 0.25),
    pause_ratio_std: 0.08,
    speech_rate_mean: Number(row.speech_rate_mean ?? 4.5),
    speech_rate_std: 1,
  };
}

async function upsertVoiceBaseline(victimId: string, features: {
  f0_mean: number;
  f0_std: number;
  jitter_local: number;
  shimmer_local: number;
  hnr_db: number;
  speech_rate: number;
  pause_ratio: number;
}) {
  const { data: existing } = await supabaseAdmin
    .from("voice_baselines")
    .select("*")
    .eq("victim_id", victimId)
    .maybeSingle();

  const n = Number(existing?.sample_count ?? 0);
  const next = n + 1;
  const blend = (prev: number | null | undefined, cur: number) =>
    n === 0 ? cur : (Number(prev ?? cur) * n + cur) / next;

  const payload = {
    victim_id: victimId,
    sample_count: next,
    f0_mean: blend(existing?.f0_mean, features.f0_mean),
    f0_std: blend(existing?.f0_std, features.f0_std),
    jitter_mean: blend(existing?.jitter_mean, features.jitter_local),
    shimmer_mean: blend(existing?.shimmer_mean, features.shimmer_local),
    hnr_mean: blend(existing?.hnr_mean, features.hnr_db),
    speech_rate_mean: blend(existing?.speech_rate_mean, features.speech_rate),
    pause_ratio_mean: blend(existing?.pause_ratio_mean, features.pause_ratio),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("voice_baselines").upsert(payload);
  if (error) console.warn("[voice_baselines]", error.message);
  return { ...payload, personal_baseline_active: next >= 3 };
}

export function intelligenceRouter() {
  const router = Router();

  /** Trajectory forecast cone + sklearn escalation blend */
  router.get("/:id/forecast", requireAuth, async (req, res, next) => {
    try {
      const caseId = String(req.params.id);
      const { data: caseRow, error } = await supabaseAdmin
        .from("cases")
        .select("*, victim:profiles!cases_victim_id_fkey(id, full_name)")
        .eq("id", caseId)
        .single();
      if (error || !caseRow) return res.status(404).json({ error: "Case not found" });
      if (!canAccessCase(req.user!.role, req.user!.id, caseRow)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { data: scores } = await supabaseAdmin
        .from("distress_scores")
        .select("score, created_at, risk_level")
        .eq("case_id", caseId)
        .order("created_at", { ascending: true })
        .limit(30);

      const { data: voiceLatest } = await supabaseAdmin
        .from("voice_analyses")
        .select("vocal_stress_index")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: storedForecast } = await supabaseAdmin
        .from("escalation_forecasts")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const scoreRows = (scores ?? []).map((s) => ({
        score: s.score,
        created_at: s.created_at,
      }));

      const missed = Number(caseRow.consecutive_missed_outreach ?? 0);
      const highStreak = [...(scores ?? [])]
        .reverse()
        .filter((s) => s.risk_level === "high" || s.risk_level === "critical").length;

      const ml = await forecastDistress({
        scores: scoreRows,
        horizon_days: 7,
        features: {
          missed_outreach: missed,
          days_since_contact: caseRow.last_contact_at
            ? Math.floor(
                (Date.now() - new Date(caseRow.last_contact_at).getTime()) / 86400000
              )
            : 0,
          bail_flag: caseRow.accused_bail_status === "granted" ? 1 : 0,
          vocal_stress: voiceLatest?.vocal_stress_index ?? 40,
          vocal_stress_index: voiceLatest?.vocal_stress_index ?? 40,
          engagement_drop: missed >= 2 ? 1 : 0,
          high_risk_streak: Math.min(highStreak, 5),
          threat_signals: 0,
        },
      });

      res.json({
        case_id: caseId,
        forecast: ml,
        stored: storedForecast,
        honesty:
          ml?.disclaimer ??
          "Synthetic / heuristic forecast — requires prospective NHAA validation.",
        history_points: scoreRows.length,
      });
    } catch (err) {
      next(err);
    }
  });

  /** Upload voice note → prosody + baseline update (Sprint 2) */
  router.post(
    "/:id/voice-note",
    requireAuth,
    upload.single("audio"),
    async (req, res, next) => {
      try {
        const caseId = String(req.params.id);
        const { data: caseRow, error } = await supabaseAdmin
          .from("cases")
          .select("*")
          .eq("id", caseId)
          .single();
        if (error || !caseRow) return res.status(404).json({ error: "Case not found" });
        if (!canAccessCase(req.user!.role, req.user!.id, caseRow)) {
          return res.status(403).json({ error: "Access denied" });
        }

        const file = req.file;
        if (!file?.buffer?.length) {
          return res.status(400).json({ error: "audio file required (field: audio)" });
        }

        const victimId = caseRow.victim_id as string;
        // Victims may only upload to own case
        if (req.user!.role === "victim" && req.user!.id !== victimId) {
          return res.status(403).json({ error: "Access denied" });
        }

        const { data: baselineRow } = await supabaseAdmin
          .from("voice_baselines")
          .select("*")
          .eq("victim_id", victimId)
          .maybeSingle();

        const analysis = await scoreVoice(
          file.buffer,
          file.mimetype || "audio/webm",
          baselineForProsody(baselineRow)
        );

        const { data: saved, error: saveErr } = await supabaseAdmin
          .from("voice_analyses")
          .insert({
            case_id: caseId,
            duration_seconds: (analysis.features_raw as { duration?: number })?.duration ?? null,
            f0_mean: analysis.f0_mean,
            f0_std: analysis.f0_std,
            jitter_local: analysis.jitter_local,
            shimmer_local: analysis.shimmer_local,
            hnr_db: analysis.hnr_db,
            speech_rate: analysis.speech_rate,
            pause_ratio: analysis.pause_ratio,
            vocal_stress_index: analysis.vocal_stress_index != null
              ? Math.round(analysis.vocal_stress_index)
              : null,
            baseline_deviation: analysis.baseline_deviation,
            confidence: analysis.confidence,
            extractor: analysis.extractor,
            features_raw: analysis.features_raw ?? {},
          })
          .select()
          .single();

        if (saveErr) {
          console.warn("[voice_analyses]", saveErr.message);
        }

        let baseline = null;
        if (analysis.confidence !== "insufficient" && analysis.confidence !== "error") {
          baseline = await upsertVoiceBaseline(victimId, {
            f0_mean: analysis.f0_mean,
            f0_std: analysis.f0_std,
            jitter_local: analysis.jitter_local,
            shimmer_local: analysis.shimmer_local,
            hnr_db: analysis.hnr_db,
            speech_rate: analysis.speech_rate,
            pause_ratio: analysis.pause_ratio,
          });
        }

        // Mirror into emotion_signals for counsellor view
        await persistEmotionSignal({
          caseId,
          analysis: analyseEmotionFromText("Voice note uploaded for stress analysis."),
          voiceStress: analysis.vocal_stress_index,
        });

        res.status(201).json({
          analysis: saved ?? analysis,
          baseline,
          honesty:
            "Vocal Stress Index uses prosody features vs population norms until ≥3 personal samples, then personal baseline. Not a clinical diagnosis.",
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
