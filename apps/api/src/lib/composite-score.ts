/**
 * Composite Distress Score v2 — weighted channels with redistributed weights.
 * Explanation comes from the same arithmetic (score_contributions), not a second LLM.
 */

import type { RiskLevel } from "@samvedna/shared-types";
import { riskFromScore } from "./distress-intelligence";

export interface ScoreContribution {
  channel: string;
  feature: string;
  feature_label: string;
  raw_value: number | null;
  weight: number;
  contribution: number;
  direction: "increases" | "decreases";
  evidence: string;
}

export interface CompositeInput {
  textScore: number;
  textSignals: string[];
  textReasoning: string;
  caseType: string;
  caseStatus: string;
  daysSinceOpened: number;
  nextHearingDate?: string | null;
  missedOutreach30d?: number;
  daysSinceLastCheckin?: number | null;
  vocalStressIndex?: number | null;
  clinicalScore?: number | null;
  crisisOverride?: boolean;
  crisisReason?: string | null;
}

export interface CompositeResult {
  score: number;
  risk_level: RiskLevel;
  components: {
    clinical: number | null;
    text: number;
    voice: number | null;
    behavioural: number | null;
    context: number;
  };
  contributions: ScoreContribution[];
  composite_version: string;
  crisis_override: boolean;
  crisis_override_reason: string | null;
  active_channels: string[];
}

const BASE_WEIGHTS = {
  clinical: 0.3,
  text_sentiment: 0.25,
  vocal_stress: 0.2,
  behavioural: 0.15,
  case_context: 0.1,
};

function contextScore(input: CompositeInput): { score: number; parts: ScoreContribution[] } {
  let s = 35;
  const parts: ScoreContribution[] = [];
  const type = input.caseType.toLowerCase();

  if (/rape|gang/.test(type)) {
    s += 18;
    parts.push({
      channel: "case_context",
      feature: "case_type_sexual_violence",
      feature_label: "Priority case type (sexual violence)",
      raw_value: 1,
      weight: 0.1,
      contribution: 18,
      direction: "increases",
      evidence: "Case type is among NHAA priority sexual-violence categories.",
    });
  } else if (/witness|intimidation/.test(type)) {
    s += 14;
    parts.push({
      channel: "case_context",
      feature: "witness_intimidation",
      feature_label: "Witness intimidation case",
      raw_value: 1,
      weight: 0.1,
      contribution: 14,
      direction: "increases",
      evidence: "Witness intimidation cases carry elevated protection risk.",
    });
  } else if (/murder|caste|atrocity|arson|grievous/.test(type)) {
    s += 12;
    parts.push({
      channel: "case_context",
      feature: "priority_atrocity_type",
      feature_label: "Priority atrocity case type",
      raw_value: 1,
      weight: 0.1,
      contribution: 12,
      direction: "increases",
      evidence: `Case type (${input.caseType}) is a POA priority use case.`,
    });
  }

  if (input.nextHearingDate) {
    const days = Math.ceil(
      (new Date(input.nextHearingDate).getTime() - Date.now()) / 86400000
    );
    if (days >= 0 && days <= 2) {
      s += 20;
      parts.push({
        channel: "case_context",
        feature: "hearing_imminent",
        feature_label: "Hearing within 48 hours",
        raw_value: days,
        weight: 0.1,
        contribution: 20,
        direction: "increases",
        evidence: `Next hearing in ${days} day(s) — predictable distress spike window.`,
      });
    }
  }

  if (/trial|compensation/.test(input.caseStatus)) {
    s += 8;
    parts.push({
      channel: "case_context",
      feature: "justice_stage_stress",
      feature_label: "High-stress justice stage",
      raw_value: 1,
      weight: 0.1,
      contribution: 8,
      direction: "increases",
      evidence: `Stage ${input.caseStatus} is associated with elevated process stress.`,
    });
  }

  if (input.daysSinceOpened > 180) {
    s += 6;
    parts.push({
      channel: "case_context",
      feature: "prolonged_case",
      feature_label: "Prolonged case duration",
      raw_value: input.daysSinceOpened,
      weight: 0.1,
      contribution: 6,
      direction: "increases",
      evidence: `Case open ${input.daysSinceOpened} days — prolonged justice journey.`,
    });
  }

  return { score: Math.min(100, s), parts };
}

function behaviouralScore(input: CompositeInput): { score: number | null; parts: ScoreContribution[] } {
  const missed = input.missedOutreach30d ?? 0;
  const days = input.daysSinceLastCheckin;
  if (missed === 0 && (days == null || days < 3)) return { score: null, parts: [] };

  let penalty = 0;
  const parts: ScoreContribution[] = [];
  if (missed >= 1) {
    const add = missed === 1 ? 8 : missed === 2 ? 18 : 30;
    penalty += add;
    parts.push({
      channel: "behavioural",
      feature: "missed_outreach",
      feature_label: "Missed scheduled contacts",
      raw_value: missed,
      weight: 0.15,
      contribution: add,
      direction: "increases",
      evidence: `${missed} missed outreach(s) in 30 days — disengagement signal.`,
    });
  }
  if (days != null && days >= 7) {
    const add = Math.min(25, Math.round(days));
    penalty += add;
    parts.push({
      channel: "behavioural",
      feature: "days_since_contact",
      feature_label: "Days since last check-in",
      raw_value: days,
      weight: 0.15,
      contribution: add,
      direction: "increases",
      evidence: `${Math.round(days)} days since last contact.`,
    });
  }
  // behavioural channel score = distress contribution from disengagement
  return { score: Math.min(100, 40 + penalty), parts };
}

export function composeDistressScore(input: CompositeInput): CompositeResult {
  if (input.crisisOverride) {
    return {
      score: 95,
      risk_level: "critical",
      components: {
        clinical: null,
        text: input.textScore,
        voice: input.vocalStressIndex ?? null,
        behavioural: null,
        context: 95,
      },
      contributions: [
        {
          channel: "clinical",
          feature: "crisis_override",
          feature_label: "Crisis override",
          raw_value: 1,
          weight: 1,
          contribution: 95,
          direction: "increases",
          evidence: input.crisisReason ?? "Deterministic crisis language detected.",
        },
      ],
      composite_version: "v2.0-crisis",
      crisis_override: true,
      crisis_override_reason: input.crisisReason ?? null,
      active_channels: ["crisis_override"],
    };
  }

  const ctx = contextScore(input);
  const beh = behaviouralScore(input);

  const present: Record<string, number> = {
    text_sentiment: input.textScore,
    case_context: ctx.score,
  };
  if (input.clinicalScore != null) present.clinical = input.clinicalScore;
  if (input.vocalStressIndex != null) present.vocal_stress = input.vocalStressIndex;
  if (beh.score != null) present.behavioural = beh.score;

  const rawWeightSum = Object.keys(present).reduce(
    (a, k) => a + (BASE_WEIGHTS[k as keyof typeof BASE_WEIGHTS] ?? 0),
    0
  );

  const contributions: ScoreContribution[] = [
    {
      channel: "text_sentiment",
      feature: "gemini_text_triage",
      feature_label: "Text / conversation triage",
      raw_value: input.textScore,
      weight: BASE_WEIGHTS.text_sentiment / rawWeightSum,
      contribution: 0, // filled below
      direction: input.textScore >= 50 ? "increases" : "decreases",
      evidence: input.textReasoning.slice(0, 220),
    },
    ...ctx.parts,
    ...beh.parts,
  ];

  if (input.vocalStressIndex != null) {
    contributions.push({
      channel: "vocal_stress",
      feature: "vocal_stress_index",
      feature_label: "Vocal stress index",
      raw_value: input.vocalStressIndex,
      weight: BASE_WEIGHTS.vocal_stress / rawWeightSum,
      contribution: 0,
      direction: "increases",
      evidence: "Voice prosody channel (when audio available).",
    });
  }
  if (input.clinicalScore != null) {
    contributions.push({
      channel: "clinical",
      feature: "clinical_instrument",
      feature_label: "Clinical instrument band",
      raw_value: input.clinicalScore,
      weight: BASE_WEIGHTS.clinical / rawWeightSum,
      contribution: 0,
      direction: "increases",
      evidence: "Recent clinical screener normalised to 0–100.",
    });
  }

  let score = 0;
  for (const [key, val] of Object.entries(present)) {
    const w = (BASE_WEIGHTS[key as keyof typeof BASE_WEIGHTS] ?? 0) / rawWeightSum;
    const contrib = w * val;
    score += contrib;
    const row = contributions.find((c) => c.channel === key || (key === "text_sentiment" && c.channel === "text_sentiment"));
    if (row && row.feature.includes("gemini") || row?.channel === key) {
      // update primary channel contribution
    }
  }

  // Set primary channel contributions cleanly
  for (const c of contributions) {
    const key =
      c.channel === "text_sentiment"
        ? "text_sentiment"
        : c.channel === "case_context"
          ? "case_context"
          : c.channel === "behavioural"
            ? "behavioural"
            : c.channel === "vocal_stress"
              ? "vocal_stress"
              : c.channel === "clinical"
                ? "clinical"
                : null;
    if (!key || present[key] == null) continue;
    const w = (BASE_WEIGHTS[key as keyof typeof BASE_WEIGHTS] ?? 0) / rawWeightSum;
    // Only set full contribution on the main feature of each channel once
    if (
      c.feature === "gemini_text_triage" ||
      c.feature === "vocal_stress_index" ||
      c.feature === "clinical_instrument" ||
      c.feature === "missed_outreach" ||
      c.feature.startsWith("case_type") ||
      c.feature === "priority_atrocity_type" ||
      c.feature === "witness_intimidation" ||
      c.feature === "hearing_imminent"
    ) {
      if (c.feature === "gemini_text_triage" || c.feature === "vocal_stress_index" || c.feature === "clinical_instrument") {
        c.weight = w;
        c.contribution = Math.round(w * (present[key] as number) * 10) / 10;
      }
    }
  }

  // Recalculate score from primary channel values only (clean)
  score = 0;
  for (const [key, val] of Object.entries(present)) {
    const w = (BASE_WEIGHTS[key as keyof typeof BASE_WEIGHTS] ?? 0) / rawWeightSum;
    score += w * val;
  }
  score = Math.round(Math.min(100, Math.max(0, score)));

  // Fix text contribution display
  const textRow = contributions.find((c) => c.feature === "gemini_text_triage");
  if (textRow) {
    const w = BASE_WEIGHTS.text_sentiment / rawWeightSum;
    textRow.weight = w;
    textRow.contribution = Math.round(w * input.textScore * 10) / 10;
  }

  return {
    score,
    risk_level: riskFromScore(score),
    components: {
      clinical: input.clinicalScore ?? null,
      text: input.textScore,
      voice: input.vocalStressIndex ?? null,
      behavioural: beh.score,
      context: ctx.score,
    },
    contributions,
    composite_version: `v2.0-active:${Object.keys(present).join("+")}`,
    crisis_override: false,
    crisis_override_reason: null,
    active_channels: Object.keys(present),
  };
}
