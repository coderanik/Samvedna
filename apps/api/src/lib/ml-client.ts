import type { DistressScoreResult, ScoreCheckinPayload } from "@samvedna/shared-types";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

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

export async function scoreCheckin(payload: ScoreCheckinPayload): Promise<DistressScoreResult> {
  try {
    const res = await fetch(`${ML_SERVICE_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      console.warn(`[ml-client] score HTTP ${res.status}`);
      return localFallback(payload);
    }

    return (await res.json()) as DistressScoreResult;
  } catch (err) {
    console.warn("[ml-client] score failed", err);
    return localFallback(payload);
  }
}
