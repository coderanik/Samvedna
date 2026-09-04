/**
 * C14 Victim Confidence Index: measures the victim's confidence in the justice system
 * and support infrastructure, based on system responsiveness and case progress.
 *
 * Factors: engagement continuity, SLA adherence, relief disbursement, adjournments.
 */

export interface ConfidenceInput {
  caseRow: {
    relief_amount_sanctioned?: number | null;
    relief_amount_disbursed?: number | null;
    adjournment_count?: number | null;
    created_at: string;
    status: string;
  };
  engagementContinuity?: {
    /** 0-100: how consistently the victim has engaged with support */
    score: number;
  };
  slaAdherence?: {
    /** % of SLA-bound events completed on time */
    adherence_rate: number;
  };
}

export interface ConfidenceResult {
  score: number; // 0-100
  confidence_band: "very_low" | "low" | "moderate" | "high";
  factors: Array<{ factor: string; impact: number; reason: string }>;
  honesty: string;
}

/**
 * Computes victim confidence index: higher score = greater confidence in the system.
 * Starts at 50 (neutral) and adjusts based on system performance indicators.
 */
export function computeVictimConfidence(input: ConfidenceInput): ConfidenceResult {
  let score = 50; // neutral baseline
  const factors: Array<{ factor: string; impact: number; reason: string }> = [];

  const { caseRow, engagementContinuity, slaAdherence } = input;

  // ── Engagement continuity ─────────────────────────────────────────────────
  // High engagement suggests confidence; low engagement may reflect lost faith
  const engagementScore = engagementContinuity?.score ?? 50;
  if (engagementScore >= 70) {
    const impact = 20;
    score += impact;
    factors.push({
      factor: "high_engagement",
      impact,
      reason: `Engagement ${engagementScore}/100 — sustained interaction signals trust`,
    });
  } else if (engagementScore < 30) {
    const impact = -20;
    score += impact;
    factors.push({
      factor: "low_engagement",
      impact,
      reason: `Engagement ${engagementScore}/100 — disengagement may reflect lost confidence`,
    });
  }

  // ── SLA adherence ─────────────────────────────────────────────────────────
  // System meeting its commitments builds confidence
  const slaRate = slaAdherence?.adherence_rate ?? null;
  if (slaRate !== null) {
    if (slaRate >= 80) {
      const impact = 15;
      score += impact;
      factors.push({
        factor: "sla_adherence_high",
        impact,
        reason: `${Math.round(slaRate)}% SLA adherence — system is reliably responsive`,
      });
    } else if (slaRate < 50) {
      const impact = -15;
      score += impact;
      factors.push({
        factor: "sla_adherence_low",
        impact,
        reason: `${Math.round(slaRate)}% SLA adherence — system delays erode confidence`,
      });
    }
  }

  // ── Relief disbursement ───────────────────────────────────────────────────
  const sanctioned = caseRow.relief_amount_sanctioned ?? 0;
  const disbursed = caseRow.relief_amount_disbursed ?? 0;
  if (sanctioned > 0) {
    const disbursementRate = (disbursed / sanctioned) * 100;
    if (disbursementRate >= 100) {
      const impact = 20;
      score += impact;
      factors.push({
        factor: "relief_fully_disbursed",
        impact,
        reason: "All sanctioned relief disbursed — tangible system support",
      });
    } else if (disbursementRate >= 50) {
      const impact = 10;
      score += impact;
      factors.push({
        factor: "relief_partially_disbursed",
        impact,
        reason: `${Math.round(disbursementRate)}% of relief disbursed — partial system follow-through`,
      });
    } else {
      const impact = -15;
      score += impact;
      factors.push({
        factor: "relief_mostly_undisbursed",
        impact,
        reason: `${Math.round(disbursementRate)}% of relief disbursed — unfulfilled promises harm trust`,
      });
    }
  }

  // ── Adjournments ──────────────────────────────────────────────────────────
  const adjournments = caseRow.adjournment_count ?? 0;
  if (adjournments >= 5) {
    const impact = -15;
    score += impact;
    factors.push({
      factor: "excessive_adjournments",
      impact,
      reason: `${adjournments} adjournments — repeated delays undermine confidence in justice`,
    });
  } else if (adjournments >= 3) {
    const impact = -8;
    score += impact;
    factors.push({
      factor: "moderate_adjournments",
      impact,
      reason: `${adjournments} adjournments — delays beginning to affect confidence`,
    });
  }

  // ── Cap score at 0-100 ────────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, Math.round(score)));

  // ── Confidence band ───────────────────────────────────────────────────────
  const confidence_band: "very_low" | "low" | "moderate" | "high" =
    score >= 70 ? "high" : score >= 50 ? "moderate" : score >= 30 ? "low" : "very_low";

  return {
    score,
    confidence_band,
    factors,
    honesty:
      "Victim confidence index reflects system responsiveness and case progress. Low confidence signals the need for intensified support and expedited action.",
  };
}
