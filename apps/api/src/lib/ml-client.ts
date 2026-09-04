import { redactPii } from "./redact";
import type { DistressScoreResult, ScoreCheckinPayload } from "@samvedna/shared-types";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

export interface ScoreCheckinOptions {
  /** False when the person has revoked `llm_processing` consent. */
  allowLlm?: boolean;
  /** Names from the case record to redact in addition to the built-in list. */
  knownNames?: string[];
}

export interface ScoredCheckin extends DistressScoreResult {
  redaction: {
    applied: boolean;
    entity_count: number;
  };
  llm_used: boolean;
  llm_skipped_reason: string | null;
}

/** Local rules fallback if ML service is down — never fails the check-in silently as "safe". */
function localFallback(payload: ScoreCheckinPayload): DistressScoreResult {
  const text = payload.transcript.toLowerCase();
  let score = 35;
  const signals: string[] = ["ml_unavailable_flagged_for_review"];
  if (/threat|danger|scared|darr|kill|suicid/.test(text)) {
    score += 25;
    signals.push("safety_concern");
  }
  if (/hopeless|alone|neend|court|money/.test(text)) {
    score += 15;
    signals.push("distress_language");
  }
  if (payload.recent_history[0]) {
    score = Math.round(score * 0.5 + payload.recent_history[0].score * 0.5);
  }
  score = Math.min(100, Math.max(20, score));
  const risk =
    score <= 30 ? "low" : score <= 55 ? "moderate" : score <= 75 ? "high" : "critical";

  return {
    score,
    risk_level: risk,
    signals_detected: signals,
    reasoning:
      "ML service unavailable — check-in preserved and flagged for human review (not marked safe).",
    sentiment: "unknown",
    emotion_indicators: [],
    trend_direction: "stable",
    escalation_risk_7d: Math.min(100, score + 15),
    escalation_reasoning: "Elevated pending review because automated scoring failed.",
    recommended_interventions: [
      {
        type: "counselling",
        description: "Human review required — ML scoring unavailable.",
      },
      { type: "follow_up", description: "Follow up within 24 hours." },
    ],
    contributing_factors: ["ml_service_failure"],
    model_confidence: "fallback",
    prediction_method: "rules_only",
  };
}

/** Rules-only path taken because consent for LLM processing was withheld. */
function consentWithheldFallback(payload: ScoreCheckinPayload): DistressScoreResult {
  const base = localFallback(payload);
  return {
    ...base,
    signals_detected: [
      ...base.signals_detected.filter((s) => s !== "ml_unavailable_flagged_for_review"),
      "llm_consent_withheld",
    ],
    reasoning:
      "Scored by transparent rules only: this person has not consented to AI processing of what they say, so no language model was called.",
    escalation_reasoning:
      "Rules-only escalation estimate — consent for AI processing was withheld.",
    contributing_factors: ["llm_consent_withheld"],
    prediction_method: "rules_only",
  };
}

export async function scoreCheckin(
  payload: ScoreCheckinPayload,
  options: ScoreCheckinOptions = {}
): Promise<ScoredCheckin> {
  // Redaction happens before anything leaves the process, including the
  // recent-history transcripts that ride along for trend context.
  const transcript = redactPii(payload.transcript, { knownNames: options.knownNames });
  let entityCount = transcript.entityCount;

  const recentHistory = payload.recent_history.map((h) => {
    const r = redactPii(h.transcript, { knownNames: options.knownNames });
    entityCount += r.entityCount;
    return { ...h, transcript: r.redacted };
  });

  const safePayload: ScoreCheckinPayload = {
    ...payload,
    transcript: transcript.redacted,
    recent_history: recentHistory,
  };

  const redaction = { applied: entityCount > 0, entity_count: entityCount };

  if (options.allowLlm === false) {
    return {
      ...consentWithheldFallback(safePayload),
      redaction,
      llm_used: false,
      llm_skipped_reason: "consent_revoked:llm_processing",
    };
  }

  try {
    const res = await fetch(`${ML_SERVICE_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safePayload),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      console.warn(`[ml-client] score HTTP ${res.status}`);
      return {
        ...localFallback(safePayload),
        redaction,
        llm_used: false,
        llm_skipped_reason: `ml_http_${res.status}`,
      };
    }

    const result = (await res.json()) as DistressScoreResult;
    return { ...result, redaction, llm_used: true, llm_skipped_reason: null };
  } catch (err) {
    console.warn("[ml-client] score failed", err);
    return {
      ...localFallback(safePayload),
      redaction,
      llm_used: false,
      llm_skipped_reason: "ml_unreachable",
    };
  }
}

/**
 * Score voice audio for vocal stress analysis.
 * 
 * @param audioBuffer - Audio file buffer
 * @param mimeType - MIME type of audio (e.g. "audio/webm", "audio/wav")
 * @param baseline - Optional personal baseline features
 */
export async function scoreVoice(
  audioBuffer: Buffer,
  mimeType: string,
  baseline?: Record<string, unknown>
): Promise<{
  vocal_stress_index: number | null;
  confidence: string;
  extractor: string;
  f0_mean: number;
  f0_std: number;
  jitter_local: number;
  shimmer_local: number;
  hnr_db: number;
  speech_rate: number;
  pause_ratio: number;
  baseline_deviation: number | null;
  features_raw: Record<string, unknown>;
}> {
  try {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append("file", blob, "audio.webm");

    if (baseline) {
      formData.append("baseline", JSON.stringify(baseline));
    }

    const res = await fetch(`${ML_SERVICE_URL}/score-voice`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      console.warn(`[ml-client] score-voice HTTP ${res.status}`);
      return {
        vocal_stress_index: null,
        confidence: "error",
        extractor: "none",
        f0_mean: 0,
        f0_std: 0,
        jitter_local: 0,
        shimmer_local: 0,
        hnr_db: 0,
        speech_rate: 0,
        pause_ratio: 0,
        baseline_deviation: null,
        features_raw: {},
      };
    }

    return (await res.json()) as Awaited<ReturnType<typeof scoreVoice>>;
  } catch (err) {
    console.warn("[ml-client] score-voice failed", err);
    return {
      vocal_stress_index: null,
      confidence: "error",
      extractor: "none",
      f0_mean: 0,
      f0_std: 0,
      jitter_local: 0,
      shimmer_local: 0,
      hnr_db: 0,
      speech_rate: 0,
      pause_ratio: 0,
      baseline_deviation: null,
      features_raw: {},
    };
  }
}

export interface ForecastPayload {
  scores: Array<{ score: number; created_at: string }>;
  horizon_days?: number;
  features?: {
    engagement_drop?: boolean;
    vocal_stress_index?: number;
    [key: string]: unknown;
  };
}

export interface ForecastResult {
  predicted_score: number;
  ci_lower: number;
  ci_upper: number;
  crisis_probability: number;
  method: string;
  trajectory: Array<{
    day: number;
    score: number;
    lower: number;
    upper: number;
  }>;
  backtest_mae: number | null;
  model_version: string;
  disclaimer: string;
}

/**
 * Forecast distress trajectory over next N days with crisis probability.
 * 
 * Uses Holt exponential smoothing when available, falls back to linear+EWMA or rule-based.
 */
export async function forecastDistress(
  payload: ForecastPayload
): Promise<ForecastResult | null> {
  try {
    const res = await fetch(`${ML_SERVICE_URL}/forecast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[ml-client] forecast HTTP ${res.status}`);
      // Local fallback: simple rule-based
      const current = payload.scores[payload.scores.length - 1]?.score ?? 50;
      return {
        predicted_score: current,
        ci_lower: Math.max(0, current - 25),
        ci_upper: Math.min(100, current + 25),
        crisis_probability: current >= 70 ? 0.5 : 0.2,
        method: "local_fallback",
        trajectory: [],
        backtest_mae: null,
        model_version: "0.0.0",
        disclaimer: "ML service unavailable — using local fallback estimate.",
      };
    }

    return (await res.json()) as ForecastResult;
  } catch (err) {
    console.warn("[ml-client] forecast failed", err);
    // Local fallback
    const current = payload.scores[payload.scores.length - 1]?.score ?? 50;
    return {
      predicted_score: current,
      ci_lower: Math.max(0, current - 25),
      ci_upper: Math.min(100, current + 25),
      crisis_probability: current >= 70 ? 0.5 : 0.2,
      method: "local_fallback",
      trajectory: [],
      backtest_mae: null,
      model_version: "0.0.0",
      disclaimer: "ML service unreachable — using local fallback estimate.",
    };
  }
}
