import { supabaseAdmin } from "./supabase";
import type { RiskLevel, TrendDirection } from "@samvedna/shared-types";

export type EmotionAnalysis = {
  sentiment: "negative" | "neutral" | "positive" | "mixed";
  valence: number; // -1..1
  arousal: number; // 0..1
  dominant_emotion: string;
  emotions: Record<string, number>;
  source: "text_llm" | "rules_fallback";
};

const NEGATIVE = [
  "fear",
  "scared",
  "threat",
  "unsafe",
  "suicide",
  "kill",
  "hopeless",
  "shame",
  "sleep",
  "nightmares",
  "crying",
  "panic",
  "anxiety",
  "hurt",
  "beat",
  "rape",
  "intimidation",
];

/**
 * Fast rule+lexicon emotion extract used when ML emotion fields are absent.
 * Production path prefers Gemini JSON from scoreCheckin when available.
 */
export function analyseEmotionFromText(
  transcript: string,
  mlHints?: {
    sentiment?: string;
    emotions?: Record<string, number>;
    dominant_emotion?: string;
  }
): EmotionAnalysis {
  if (mlHints?.emotions && Object.keys(mlHints.emotions).length) {
    const entries = Object.entries(mlHints.emotions).sort((a, b) => b[1] - a[1]);
    return {
      sentiment: (mlHints.sentiment as EmotionAnalysis["sentiment"]) ?? "mixed",
      valence: Number(mlHints.emotions.valence ?? estimateValence(transcript)),
      arousal: Number(mlHints.emotions.arousal ?? 0.5),
      dominant_emotion: mlHints.dominant_emotion ?? entries[0]?.[0] ?? "distress",
      emotions: mlHints.emotions,
      source: "text_llm",
    };
  }

  const t = transcript.toLowerCase();
  const hits = NEGATIVE.filter((w) => t.includes(w));
  const intensity = Math.min(1, hits.length / 6);
  const crisis = /suicid|kill myself|end my life|no reason to live/.test(t);
  const fear = /threat|scared|unsafe|intimidation|afraid/.test(t);
  const emotions: Record<string, number> = {
    fear: fear ? 0.7 + intensity * 0.2 : intensity * 0.3,
    sadness: /cry|hopeless|alone|grief/.test(t) ? 0.6 : intensity * 0.25,
    anger: /angry|furious|hate/.test(t) ? 0.55 : 0.1,
    shame: /shame|humiliat/.test(t) ? 0.5 : 0.1,
    hope: /better|hope|support|safe now/.test(t) ? 0.4 : 0.05,
  };
  if (crisis) emotions.hopelessness = 0.95;

  const dominant =
    Object.entries(emotions).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "distress";

  return {
    sentiment: crisis || intensity > 0.45 ? "negative" : intensity > 0.2 ? "mixed" : "neutral",
    valence: estimateValence(transcript),
    arousal: crisis ? 0.9 : Math.min(1, 0.3 + intensity),
    dominant_emotion: dominant,
    emotions,
    source: "rules_fallback",
  };
}

function estimateValence(transcript: string) {
  const t = transcript.toLowerCase();
  let v = 0;
  if (/better|hope|thank|safe|support/.test(t)) v += 0.35;
  if (/fear|threat|hurt|cry|suicid|unsafe/.test(t)) v -= 0.55;
  return Math.max(-1, Math.min(1, v));
}

export async function persistEmotionSignal(opts: {
  caseId: string;
  checkinId?: string;
  distressScoreId?: string;
  analysis: EmotionAnalysis;
  voiceStress?: number | null;
}) {
  const { error } = await supabaseAdmin.from("emotion_signals").insert({
    case_id: opts.caseId,
    checkin_id: opts.checkinId ?? null,
    distress_score_id: opts.distressScoreId ?? null,
    sentiment: opts.analysis.sentiment,
    valence: opts.analysis.valence,
    arousal: opts.analysis.arousal,
    dominant_emotion: opts.analysis.dominant_emotion,
    emotions: opts.analysis.emotions,
    voice_stress: opts.voiceStress ?? null,
    source: opts.analysis.source,
  });
  if (error) console.warn("[emotion_signals]", error.message);
}

export type EscalationForecast = {
  risk_7d: number;
  risk_14d: number;
  trend: TrendDirection;
  drivers: string[];
  confidence: "high" | "medium" | "low";
  honesty_note: string;
  model_version: string;
};

/**
 * Heuristic predictive risk model (LIVE for demo).
 * Honesty: not prospectively validated on NHAA outcomes.
 */
export function computeEscalationForecast(input: {
  latestScore: number;
  risk: RiskLevel;
  history: Array<{ score: number; risk_level: RiskLevel }>;
  missedOutreach?: number;
  daysSinceContact?: number | null;
  bailGranted?: boolean;
  threatSignals?: number;
  crisisOverride?: boolean;
}): EscalationForecast {
  const honesty_note =
    "Heuristic escalation model (v1). Calibrated on synthetic longitudinal patterns — not prospectively validated on NHAA outcome data.";

  if (input.crisisOverride) {
    return {
      risk_7d: 95,
      risk_14d: 92,
      trend: "rising",
      drivers: ["Crisis language / safety override"],
      confidence: "high",
      honesty_note,
      model_version: "heuristic_v1",
    };
  }

  const scores = input.history.map((h) => h.score);
  const slope =
    scores.length >= 2 ? scores[0]! - scores[Math.min(scores.length - 1, 3)]! : 0;

  let risk7 = input.latestScore * 0.55;
  risk7 += Math.max(0, slope) * 0.35;
  risk7 += (input.missedOutreach ?? 0) * 8;
  risk7 += Math.min(25, (input.daysSinceContact ?? 0) * 1.5);
  risk7 += (input.threatSignals ?? 0) * 12;
  if (input.bailGranted) risk7 += 15;
  if (input.risk === "critical") risk7 += 10;
  if (input.risk === "high") risk7 += 5;

  risk7 = Math.round(Math.max(0, Math.min(100, risk7)));
  const risk14 = Math.round(Math.max(0, Math.min(100, risk7 * 0.9 + Math.max(0, slope) * 0.15)));

  const drivers: string[] = [];
  if (slope > 8) drivers.push(`Rising distress slope (+${Math.round(slope)} pts)`);
  if ((input.missedOutreach ?? 0) > 0)
    drivers.push(`${input.missedOutreach} missed outreach contact(s)`);
  if ((input.daysSinceContact ?? 0) >= 5)
    drivers.push(`${input.daysSinceContact} days since last contact`);
  if (input.bailGranted) drivers.push("Accused bail event elevates proximity risk");
  if ((input.threatSignals ?? 0) > 0) drivers.push("Threat / intimidation language detected");
  if (input.latestScore >= 70) drivers.push("Current distress in severe range");
  if (!drivers.length) drivers.push("Stable recent pattern");

  const trend: TrendDirection =
    slope > 6 ? "rising" : slope < -6 ? "improving" : "stable";

  return {
    risk_7d: risk7,
    risk_14d: risk14,
    trend,
    drivers,
    confidence: scores.length >= 3 ? "medium" : "low",
    honesty_note,
    model_version: "heuristic_v1",
  };
}

export async function persistEscalationForecast(
  caseId: string,
  forecast: EscalationForecast
) {
  const { error } = await supabaseAdmin.from("escalation_forecasts").insert({
    case_id: caseId,
    risk_7d: forecast.risk_7d,
    risk_14d: forecast.risk_14d,
    trend: forecast.trend,
    drivers: forecast.drivers,
    confidence: forecast.confidence,
    honesty_note: forecast.honesty_note,
    model_version: forecast.model_version,
  });
  if (error) console.warn("[escalation_forecasts]", error.message);
}
