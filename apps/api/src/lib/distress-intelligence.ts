/**
 * Transparent MVP distress intelligence:
 * longitudinal trend + escalation risk from historical scores.
 * Labelled as decision-support triage — NOT a clinically validated model.
 */

import type { RiskLevel } from "@samvedna/shared-types";

export type TrendDirection = "rising" | "stable" | "improving";

export interface ScorePoint {
  score: number;
  risk_level: RiskLevel;
  created_at: string;
}

export interface DistressIntelligence {
  current_score: number;
  current_risk: RiskLevel;
  previous_score: number | null;
  average_score: number;
  trend_direction: TrendDirection;
  score_delta: number;
  consecutive_elevated: number;
  high_risk_count: number;
  escalation_risk_7d: number;
  contributing_factors: string[];
  prediction_method: "mvp_rules_plus_llm" | "rules_only";
}

const RISK_WEIGHT: Record<RiskLevel, number> = {
  low: 0,
  moderate: 15,
  high: 35,
  critical: 50,
};

export function riskFromScore(score: number): RiskLevel {
  if (score <= 30) return "low";
  if (score <= 55) return "moderate";
  if (score <= 75) return "high";
  return "critical";
}

export function computeTrend(pointsNewestFirst: ScorePoint[]): TrendDirection {
  if (pointsNewestFirst.length < 2) return "stable";
  const newest = pointsNewestFirst[0].score;
  const older = pointsNewestFirst[Math.min(2, pointsNewestFirst.length - 1)].score;
  const delta = newest - older;
  if (delta >= 8) return "rising";
  if (delta <= -8) return "improving";
  return "stable";
}

export function computeDistressIntelligence(
  current: { score: number; risk_level: RiskLevel },
  historyNewestFirst: ScorePoint[],
  signals: string[] = []
): DistressIntelligence {
  const all = [
    { score: current.score, risk_level: current.risk_level, created_at: new Date().toISOString() },
    ...historyNewestFirst,
  ];
  const scores = all.map((p) => p.score);
  const average_score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const previous_score = historyNewestFirst[0]?.score ?? null;
  const score_delta = previous_score == null ? 0 : current.score - previous_score;
  const trend_direction = computeTrend(all);

  let consecutive_elevated = 0;
  for (const p of all) {
    if (p.risk_level === "high" || p.risk_level === "critical") consecutive_elevated += 1;
    else break;
  }

  const high_risk_count = all.filter(
    (p) => p.risk_level === "high" || p.risk_level === "critical"
  ).length;

  const factors: string[] = [];
  let escalation = RISK_WEIGHT[current.risk_level] + Math.round(current.score * 0.35);

  if (trend_direction === "rising") {
    escalation += 18;
    factors.push("distress_trend_rising");
  }
  if (score_delta >= 15) {
    escalation += 12;
    factors.push("sudden_score_increase");
  }
  if (consecutive_elevated >= 2) {
    escalation += 10 * Math.min(consecutive_elevated, 4);
    factors.push(`consecutive_elevated_${consecutive_elevated}`);
  }
  if (high_risk_count >= 3) {
    escalation += 8;
    factors.push("repeated_high_risk_interactions");
  }

  const threatSignals = signals.filter((s) =>
    /threat|safety|intimidation|hopeless|suicid|fear|isolation/i.test(s)
  );
  if (threatSignals.length) {
    escalation += 8 * Math.min(threatSignals.length, 3);
    factors.push(...threatSignals.slice(0, 3).map((s) => `signal_${s}`));
  }

  if (trend_direction === "improving" && current.risk_level !== "critical") {
    escalation -= 12;
    factors.push("trend_improving");
  }

  const escalation_risk_7d = Math.min(100, Math.max(0, Math.round(escalation)));

  return {
    current_score: current.score,
    current_risk: current.risk_level,
    previous_score,
    average_score,
    trend_direction,
    score_delta,
    consecutive_elevated,
    high_risk_count,
    escalation_risk_7d,
    contributing_factors: [...new Set(factors)],
    prediction_method: "mvp_rules_plus_llm",
  };
}

/** Counsellor queue priority — higher = needs attention sooner. */
export function computePriorityScore(opts: {
  risk: RiskLevel;
  escalation_risk_7d: number;
  trend: TrendDirection;
  consecutive_elevated: number;
  case_type: string;
  hours_since_interaction: number | null;
}): number {
  let p = RISK_WEIGHT[opts.risk] + opts.escalation_risk_7d * 0.5;
  if (opts.trend === "rising") p += 15;
  p += Math.min(opts.consecutive_elevated, 5) * 6;

  const type = opts.case_type.toLowerCase();
  if (/rape|gang|sexual/.test(type)) p += 20;
  else if (/witness|intimidation|threat/.test(type)) p += 16;
  else if (/murder|grievous|arson|caste|atrocity/.test(type)) p += 14;

  if (opts.hours_since_interaction != null && opts.hours_since_interaction > 72) p += 10;
  if (opts.hours_since_interaction != null && opts.hours_since_interaction > 168) p += 10;

  return Math.round(Math.min(100, p));
}

export function defaultInterventions(
  risk: RiskLevel,
  escalation: number,
  signals: string[],
  caseType: string
): { type: string; description: string }[] {
  const out: { type: string; description: string }[] = [];
  const type = caseType.toLowerCase();

  if (risk === "critical" || escalation >= 75) {
    out.push({
      type: "counselling",
      description: "Immediate counsellor contact recommended (human triage).",
    });
    out.push({
      type: "follow_up",
      description: "Schedule follow-up within 24 hours.",
    });
  } else if (risk === "high" || escalation >= 55) {
    out.push({
      type: "counselling",
      description: "Priority counselling session within 48 hours.",
    });
    out.push({
      type: "follow_up",
      description: "Check-in follow-up within 72 hours.",
    });
  } else if (risk === "moderate") {
    out.push({
      type: "follow_up",
      description: "Continue scheduled monitoring; offer optional counselling.",
    });
  }

  if (signals.some((s) => /threat|safety|intimidation/i.test(s)) || /witness/i.test(type)) {
    out.push({
      type: "witness_protection",
      description: "Review witness protection / safety plan with authorised officials.",
    });
  }
  if (signals.some((s) => /financial|compensation|money/i.test(s))) {
    out.push({
      type: "financial",
      description: "Review compensation / relief assistance status.",
    });
  }
  if (signals.some((s) => /medical|sleep|somatic|pain/i.test(s))) {
    out.push({
      type: "medical",
      description: "Consider referral for medical / psychological assessment.",
    });
  }
  if (signals.some((s) => /legal|court|trial/i.test(s))) {
    out.push({
      type: "legal",
      description: "Offer legal aid / process orientation support.",
    });
  }
  if (/caste|atrocity|reloc|ostrac/i.test(type) || signals.some((s) => /reloc|ostrac/i.test(s))) {
    out.push({
      type: "relocation",
      description: "Assess relocation / rehabilitation support needs.",
    });
  }

  return out.slice(0, 5);
}
