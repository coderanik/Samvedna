/**
 * C6 Case Attrition Risk: likelihood the case will be withdrawn or abandoned.
 *
 * Factors: sustained high distress, threat signals, engagement collapse, bail granted,
 * case age, relief non-disbursement, adjournments, protection not granted.
 */

import type { RiskLevel } from "@samvedna/shared-types";
import type { EngagementResult } from "./engagement";

export interface AttritionInput {
  caseRow: {
    status: string;
    created_at: string;
    fir_date?: string | null;
    incident_date?: string | null;
    accused_bail_status?: string | null;
    bail_granted_date?: string | null;
    accused_village_same_as_victim?: boolean | null;
    protection_order_active?: boolean | null;
    protection_requested?: boolean | null;
    relief_amount_sanctioned?: number | null;
    relief_amount_disbursed?: number | null;
    relief_due_date?: string | null;
    adjournment_count?: number | null;
  };
  latestScore?: {
    score: number;
    risk_level: RiskLevel;
    threat_score?: number | null;
  } | null;
  recentScores?: Array<{ score: number; risk_level: RiskLevel }>;
  engagement?: EngagementResult | null;
  missedOutreach?: number;
}

export interface AttritionFactor {
  factor: string;
  weight: number;
  reason: string;
}

export interface AttritionResult {
  score: number; // 0-100
  risk_band: "low" | "moderate" | "high" | "critical";
  factors: AttritionFactor[];
  recommended_codes: string[];
  honesty: string;
}

/**
 * Computes case attrition risk score.
 * Higher score = higher risk of case withdrawal or abandonment.
 */
export function computeAttritionRisk(input: AttritionInput): AttritionResult {
  const factors: AttritionFactor[] = [];
  let score = 0;

  const { caseRow, latestScore, recentScores, engagement, missedOutreach } = input;

  // ── Sustained high distress (psychological exhaustion) ────────────────────
  const sustainedHighDistress =
    (recentScores ?? []).filter((s) => s.risk_level === "high" || s.risk_level === "critical")
      .length >= 3;
  if (sustainedHighDistress) {
    const weight = 15;
    score += weight;
    factors.push({
      factor: "sustained_high_distress",
      weight,
      reason: "3+ consecutive high/critical distress scores — psychological exhaustion risk",
    });
  }

  // ── Threat signals ────────────────────────────────────────────────────────
  const threatScore = latestScore?.threat_score ?? 0;
  if (threatScore >= 60) {
    const weight = 20;
    score += weight;
    factors.push({
      factor: "threat_signals",
      weight,
      reason: `Threat score ${threatScore}/100 — intimidation may lead to withdrawal`,
    });
  }

  // ── Engagement collapse ───────────────────────────────────────────────────
  const engagementCollapse = (engagement?.engagement_score ?? 100) < 30;
  if (engagementCollapse) {
    const weight = 18;
    score += weight;
    factors.push({
      factor: "engagement_collapse",
      weight,
      reason: `Engagement score ${engagement?.engagement_score ?? 0}/100 — disengagement from support system`,
    });
  }

  const missedCount = missedOutreach ?? 0;
  if (missedCount >= 2) {
    const weight = Math.min(12, missedCount * 4);
    score += weight;
    factors.push({
      factor: "missed_outreach",
      weight,
      reason: `${missedCount} consecutive missed contacts — victim may be withdrawing`,
    });
  }

  // ── Bail granted ──────────────────────────────────────────────────────────
  const bailGranted = caseRow.accused_bail_status === "granted";
  if (bailGranted) {
    const weight = 15;
    score += weight;
    factors.push({
      factor: "bail_granted",
      weight,
      reason: "Accused released on bail — increased intimidation risk and victim safety concerns",
    });

    // Extra risk if accused is from same village
    if (caseRow.accused_village_same_as_victim === true) {
      const extraWeight = 10;
      score += extraWeight;
      factors.push({
        factor: "same_village_post_bail",
        weight: extraWeight,
        reason: "Accused from same village and out on bail — severe proximity intimidation risk",
      });
    }
  }

  // ── Case age (months since FIR or incident) ──────────────────────────────
  const referenceDate = caseRow.fir_date ?? caseRow.incident_date ?? caseRow.created_at;
  const monthsSinceStart =
    (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24 * 30);

  if (monthsSinceStart >= 18) {
    const weight = 12;
    score += weight;
    factors.push({
      factor: "case_age",
      weight,
      reason: `${Math.round(monthsSinceStart)} months since incident — attrition risk rises with time`,
    });
  }

  // ── Relief non-disbursement ───────────────────────────────────────────────
  const sanctioned = caseRow.relief_amount_sanctioned ?? 0;
  const disbursed = caseRow.relief_amount_disbursed ?? 0;
  const shortfall = sanctioned - disbursed;

  if (sanctioned > 0 && shortfall > 0) {
    const dueDatePassed =
      caseRow.relief_due_date && new Date(caseRow.relief_due_date).getTime() < Date.now();
    if (dueDatePassed) {
      const weight = 10;
      score += weight;
      factors.push({
        factor: "relief_not_disbursed",
        weight,
        reason: `₹${shortfall.toLocaleString("en-IN")} relief sanctioned but not disbursed — erodes faith in system`,
      });
    }
  }

  // ── Adjournments ──────────────────────────────────────────────────────────
  const adjournments = caseRow.adjournment_count ?? 0;
  if (adjournments >= 3) {
    const weight = Math.min(10, adjournments * 2);
    score += weight;
    factors.push({
      factor: "adjournments",
      weight,
      reason: `${adjournments} adjournments — repeated delays exhaust victim patience`,
    });
  }

  // ── Protection order not granted when requested ───────────────────────────
  const protectionRequested = caseRow.protection_requested === true;
  const protectionActive = caseRow.protection_order_active === true;
  if (protectionRequested && !protectionActive) {
    const weight = 8;
    score += weight;
    factors.push({
      factor: "protection_denied",
      weight,
      reason: "Protection order requested but not granted — victim may feel unsafe pursuing case",
    });
  }

  // ── Cap score at 100 ──────────────────────────────────────────────────────
  score = Math.min(100, Math.round(score));

  // ── Risk band ─────────────────────────────────────────────────────────────
  const risk_band: "low" | "moderate" | "high" | "critical" =
    score >= 75 ? "critical" : score >= 55 ? "high" : score >= 35 ? "moderate" : "low";

  // ── Recommended intervention codes ────────────────────────────────────────
  const recommended_codes: string[] = [];
  if (factors.some((f) => f.factor === "threat_signals" || f.factor === "bail_granted")) {
    recommended_codes.push("POA_WITNESS_PROTECT");
  }
  if (factors.some((f) => f.factor === "sustained_high_distress")) {
    recommended_codes.push("CRISIS_PSYCH");
  }
  if (factors.some((f) => f.factor === "relief_not_disbursed")) {
    recommended_codes.push("COMP_EXPED");
  }
  if (factors.some((f) => f.factor === "engagement_collapse" || f.factor === "missed_outreach")) {
    recommended_codes.push("COUNSEL_INTENS");
  }

  return {
    score,
    risk_band,
    factors,
    recommended_codes,
    honesty:
      "Attrition risk is a composite of clinical, behavioural, and statutory factors. High risk does not mean withdrawal is certain, but signals the need for proactive support.",
  };
}
