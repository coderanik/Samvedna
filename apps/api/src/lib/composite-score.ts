/**
 * Composite Distress Score v2.
 *
 * Five channels, weighted, with weight redistribution when a channel is absent.
 * The explanation in `contributions` is not a second model rationalising the
 * first — it is the same arithmetic, decomposed. The identity that must always
 * hold is:
 *
 *     score = COMPOSITE_BASE + Σ contributions[].contribution
 *
 * so every point of the final score is attributable to a named feature with an
 * evidence string.
 */

import type { RiskLevel } from "@samvedna/shared-types";
import { riskFromScore } from "./distress-intelligence";
import { clampNumber } from "./db-safe";
import type { EngagementPenalty } from "./engagement";

export type CompositeChannel =
  | "clinical"
  | "text_sentiment"
  | "vocal_stress"
  | "behavioural"
  | "case_context";

export type ContributionDirection = "increases" | "decreases" | "neutral";

/** Neutral midpoint of the 0-100 distress band; channels are signed against it. */
export const COMPOSITE_BASE = 50;

export const COMPOSITE_VERSION = "v2.0";

export const CHANNEL_BASE_WEIGHTS: Record<CompositeChannel, number> = {
  clinical: 0.3,
  text_sentiment: 0.25,
  vocal_stress: 0.2,
  behavioural: 0.15,
  case_context: 0.1,
};

export const CHANNEL_LABELS: Record<CompositeChannel, string> = {
  clinical: "Clinical screening instruments",
  text_sentiment: "What they said",
  vocal_stress: "How their voice sounded",
  behavioural: "Engagement and silence",
  case_context: "Where the case stands",
};

// ─── Crisis override ─────────────────────────────────────────────────────────

export interface CrisisAssessmentInput {
  instrument: string;
  positive_screen: boolean | null;
}

export interface CrisisDetection {
  triggered: true;
  reason: string;
  source: "clinical_cssrs" | "transcript_language" | "ml_signal" | "active_threat";
}

/**
 * Any ONE of these is sufficient. They are deliberately not required to agree:
 * demanding corroboration before escalating a suicide disclosure is exactly the
 * failure mode this override exists to prevent.
 */
const SELF_HARM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\b(?:suicide|suicidal|kill myself|killing myself|end my life|end it all|take my life|want to die|wanna die|better off dead|no reason to live|nothing to live for|hang myself|self[-\s]?harm|cut myself|overdose)\b/i,
    label: "English self-harm / suicide language",
  },
  {
    re: /(?:आत्महत्या|खुदकुशी|खुदखुशी|जान\s*दे|जान\s*देने|मरना\s*चाह|मर\s*जाऊ|मर\s*जाना\s*चाह|जीने\s*का\s*मन\s*नहीं|जीना\s*नहीं\s*चाह|फांसी\s*लगा)/,
    label: "Hindi (Devanagari) self-harm / suicide language",
  },
  {
    re: /\b(?:aatmahatya|atmahatya|khudkushi|khudkhushi|marna\s*chah(?:ta|ti|ata|ati)|mar\s*jaung?a|mar\s*jaungi|jaan\s*de\s*dung?a|jaan\s*de\s*dungi|jeene?\s*ka\s*mann?\s*nahi|jeena\s*nahi\s*chahta|phansi\s*laga)\b/i,
    label: "Romanised Hindi self-harm / suicide language",
  },
  {
    re: /(?:தற்கொலை|சாக\s*வேண்டும்|செத்து\s*விட|செத்துவிட|உயிரை\s*விட|இறந்து\s*விட)/,
    label: "Tamil self-harm / suicide language",
  },
];

const ACTIVE_THREAT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\b(?:(?:they|he|she|the accused|his family)\s+(?:will|are going to|is going to|threatened to)\s+(?:kill|rape|burn|finish|attack)\s+(?:me|us|my family)|going to kill me|threatening to kill|jaan se maar|jaan se maarne|maar dalenge|maar dalunga)\b/i,
    label: "Active threat to life",
  },
  { re: /(?:मार\s*डालेंगे|जान\s*से\s*मार|घर\s*जला)/, label: "Active threat to life (Hindi)" },
  {
    re: /\b(?:withdraw the case|withdraw my complaint|take back the case|not to testify|not to give evidence|stop me from testifying|gawahi\s*(?:wapas|nahi)|case\s*wapas|samjhauta karne ka dabaav)\b/i,
    label: "Witness intimidation in progress",
  },
  { re: /(?:गवाही\s*(?:वापस|नहीं)|केस\s*वापस\s*ले|दबाव\s*डाल\s*रहे)/, label: "Witness intimidation in progress (Hindi)" },
];

const ML_CRISIS_SIGNAL_RE =
  /suicid|self[-_\s]?harm|selfharm|crisis|life[-_\s]?threat|active[-_\s]?threat|imminent[-_\s]?danger/i;

/**
 * Deterministic, side-effect-free crisis check. Returns null when nothing
 * fires — callers treat null as "compose normally".
 */
export function detectCrisis(
  transcript: string,
  signals: string[] = [],
  assessments: CrisisAssessmentInput[] = []
): CrisisDetection | null {
  const cssrs = assessments.find(
    (a) => a.instrument === "cssrs" && a.positive_screen === true
  );
  if (cssrs) {
    return {
      triggered: true,
      reason:
        "C-SSRS suicide-risk screen returned a positive result — immediate human escalation required.",
      source: "clinical_cssrs",
    };
  }

  const text = (transcript ?? "").trim();

  for (const { re, label } of SELF_HARM_PATTERNS) {
    if (re.test(text)) {
      return {
        triggered: true,
        reason: `${label} detected in what they said — immediate human escalation required.`,
        source: "transcript_language",
      };
    }
  }

  const mlSignal = signals.find((s) => ML_CRISIS_SIGNAL_RE.test(s));
  if (mlSignal) {
    return {
      triggered: true,
      reason: `Automated screening flagged "${mlSignal}" — immediate human escalation required.`,
      source: "ml_signal",
    };
  }

  for (const { re, label } of ACTIVE_THREAT_PATTERNS) {
    if (re.test(text)) {
      return {
        triggered: true,
        reason: `${label} described as ongoing — immediate protection response required.`,
        source: "active_threat",
      };
    }
  }

  return null;
}

// ─── Channel inputs ──────────────────────────────────────────────────────────

export interface ClinicalAssessmentInput {
  instrument: string;
  total_score: number | null;
  max_score: number | null;
  severity_band: string | null;
  positive_screen: boolean | null;
  created_at: string;
}

export interface VoiceAnalysisInput {
  vocal_stress_index: number | null;
  baseline_deviation: number | null;
  confidence: string | null;
  f0_mean?: number | null;
  jitter_local?: number | null;
  shimmer_local?: number | null;
  hnr_db?: number | null;
  speech_rate?: number | null;
  pause_ratio?: number | null;
}

export interface BehaviouralInput {
  engagement_score: number;
  penalties: EngagementPenalty[];
  prior_checkin_count: number;
}

export interface CaseContextInput {
  caseType: string;
  caseStatus: string;
  nextHearingDate?: string | null;
  reliefDueDate?: string | null;
  reliefAmountSanctioned?: number | null;
  reliefAmountDisbursed?: number | null;
  lastContactAt?: string | null;
  daysSinceLastContact?: number | null;
}

export interface CompositeInput {
  text: { score: number; reasoning: string; signals: string[] };
  clinical?: ClinicalAssessmentInput[] | null;
  voice?: VoiceAnalysisInput | null;
  behavioural?: BehaviouralInput | null;
  context: CaseContextInput;
  crisis?: CrisisDetection | null;
  /** Reference instant, injectable for tests. */
  now?: Date;
}

// ─── Result ──────────────────────────────────────────────────────────────────

export interface ScoreContribution {
  channel: CompositeChannel;
  feature: string;
  feature_label: string;
  raw_value: number | null;
  weight: number;
  contribution: number;
  direction: ContributionDirection;
  evidence: string;
}

export interface CompositeChannelResult {
  channel: CompositeChannel;
  label: string;
  base_weight: number;
  weight: number;
  score: number;
  contribution: number;
  features: ScoreContribution[];
}

export interface ActiveChannelRecord {
  channel: CompositeChannel;
  base_weight: number;
  effective_weight: number;
  score: number;
}

export interface CompositeResult {
  score: number;
  risk_level: RiskLevel;
  base: number;
  components: {
    clinical: number | null;
    text: number;
    voice: number | null;
    behavioural: number | null;
    context: number;
  };
  channels: CompositeChannelResult[];
  active_channels: ActiveChannelRecord[];
  contributions: ScoreContribution[];
  composite_version: string;
  crisis_override: boolean;
  crisis_override_reason: string | null;
  absent_channels: CompositeChannel[];
  redistribution_note: string;
}

const CLINICAL_WINDOW_DAYS = 14;

const SEVERITY_BAND_SCORES: Array<{ re: RegExp; score: number }> = [
  { re: /^(none|minimal|no[-_\s]?risk)/i, score: 8 },
  { re: /^(mild|low)/i, score: 32 },
  { re: /^(moderately[-_\s]?severe)/i, score: 72 },
  { re: /^(moderate|medium)/i, score: 55 },
  { re: /^(severe|extremely|high)/i, score: 88 },
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function daysUntil(dateish: string, now: Date): number {
  return Math.ceil((new Date(dateish).getTime() - now.getTime()) / 86_400_000);
}

/** 0-100 from an instrument, preferring the raw score over the band label. */
export function normaliseClinicalScore(a: ClinicalAssessmentInput): number | null {
  if (a.total_score != null && a.max_score != null && a.max_score > 0) {
    return Math.round(clampNumber((a.total_score / a.max_score) * 100, 0, 100));
  }
  if (a.severity_band) {
    const hit = SEVERITY_BAND_SCORES.find((s) => s.re.test(a.severity_band!.trim()));
    if (hit) return hit.score;
  }
  if (a.positive_screen === true) return 70;
  if (a.positive_screen === false) return 20;
  return null;
}

interface FeaturePoints {
  feature: string;
  feature_label: string;
  raw_value: number | null;
  points: number;
  evidence: string;
}

/** case_context sub-score: additive stressors, 0 when the case is quiet. */
function buildContext(
  input: CaseContextInput,
  now: Date
): { score: number; features: FeaturePoints[]; neutral: FeaturePoints[] } {
  const features: FeaturePoints[] = [];
  const neutral: FeaturePoints[] = [];
  const type = (input.caseType ?? "").toLowerCase();
  const status = (input.caseStatus ?? "").toLowerCase();

  if (input.nextHearingDate) {
    const days = daysUntil(input.nextHearingDate, now);
    if (days >= 0 && days <= 2) {
      features.push({
        feature: "hearing_imminent",
        feature_label: "Hearing within 48 hours",
        raw_value: days,
        points: 30,
        evidence:
          days === 0
            ? "Hearing is today."
            : `Hearing scheduled in ${days} day${days === 1 ? "" : "s"}.`,
      });
    } else if (days > 2 && days <= 7) {
      features.push({
        feature: "hearing_this_week",
        feature_label: "Hearing within a week",
        raw_value: days,
        points: 18,
        evidence: `Hearing scheduled in ${days} days.`,
      });
    } else {
      neutral.push({
        feature: "hearing_not_imminent",
        feature_label: "No hearing imminent",
        raw_value: days,
        points: 0,
        evidence:
          days < 0
            ? `Last listed hearing was ${Math.abs(days)} days ago.`
            : `Next hearing is ${days} days away.`,
      });
    }
  }

  const sanctioned = input.reliefAmountSanctioned ?? null;
  const disbursed = input.reliefAmountDisbursed ?? 0;
  if (
    input.reliefDueDate &&
    new Date(input.reliefDueDate).getTime() < now.getTime() &&
    sanctioned != null &&
    disbursed < sanctioned
  ) {
    const shortfall = sanctioned - disbursed;
    features.push({
      feature: "relief_overdue",
      feature_label: "Statutory relief overdue",
      raw_value: shortfall,
      points: 25,
      evidence: `Relief was due on ${input.reliefDueDate} and ₹${shortfall.toLocaleString("en-IN")} of ₹${sanctioned.toLocaleString("en-IN")} is still undisbursed.`,
    });
  }

  // Ordered most-severe-first: "gang rape" must not fall through to a milder band.
  if (/rape|sexual/.test(type)) {
    features.push({
      feature: "case_type_sexual_violence",
      feature_label: "Case type: sexual violence",
      raw_value: null,
      points: 20,
      evidence: `Case type "${input.caseType}" carries the highest distress load among POA Act offences.`,
    });
  } else if (/witness|intimidat/.test(type)) {
    features.push({
      feature: "case_type_witness_intimidation",
      feature_label: "Case type: witness intimidation",
      raw_value: null,
      points: 18,
      evidence: `Case type "${input.caseType}" means ongoing pressure from the accused side.`,
    });
  } else if (/murder|grievous|arson/.test(type)) {
    features.push({
      feature: "case_type_grave_offence",
      feature_label: "Case type: grave offence",
      raw_value: null,
      points: 16,
      evidence: `Case type "${input.caseType}" is a grave offence under the POA Act.`,
    });
  } else if (/caste|atrocity|untouch|social boycott/.test(type)) {
    features.push({
      feature: "case_type_caste_violence",
      feature_label: "Case type: caste violence",
      raw_value: null,
      points: 14,
      evidence: `Case type "${input.caseType}" involves continuing community hostility.`,
    });
  }

  if (/trial/.test(status)) {
    features.push({
      feature: "stage_trial",
      feature_label: "Case stage: trial",
      raw_value: null,
      points: 12,
      evidence: "Case is at trial — repeated court appearances and cross-examination.",
    });
  } else if (/compensation/.test(status)) {
    features.push({
      feature: "stage_compensation",
      feature_label: "Case stage: compensation",
      raw_value: null,
      points: 8,
      evidence: "Case is at the compensation stage — financial uncertainty is active.",
    });
  }

  const daysSinceContact =
    input.daysSinceLastContact ??
    (input.lastContactAt
      ? (now.getTime() - new Date(input.lastContactAt).getTime()) / 86_400_000
      : null);

  if (daysSinceContact != null && daysSinceContact > 14) {
    features.push({
      feature: "no_recent_contact",
      feature_label: "No contact in over two weeks",
      raw_value: round1(daysSinceContact),
      points: 15,
      evidence: `${Math.round(daysSinceContact)} days since the last recorded contact.`,
    });
  }

  const score = clampNumber(
    features.reduce((a, f) => a + f.points, 0),
    0,
    100
  );

  return { score, features, neutral };
}

function voiceNeutralFeatures(v: VoiceAnalysisInput): FeaturePoints[] {
  const out: FeaturePoints[] = [];
  const add = (feature: string, label: string, value: number | null | undefined, evidence: string) => {
    if (value == null) return;
    out.push({ feature, feature_label: label, raw_value: round1(value), points: 0, evidence });
  };

  add("voice_jitter", "Pitch instability (jitter)", v.jitter_local, `Local jitter ${round1(v.jitter_local ?? 0)} — cycle-to-cycle pitch variation.`);
  add("voice_shimmer", "Loudness instability (shimmer)", v.shimmer_local, `Local shimmer ${round1(v.shimmer_local ?? 0)} — amplitude variation.`);
  add("voice_hnr", "Voice clarity (HNR)", v.hnr_db, `Harmonic-to-noise ratio ${round1(v.hnr_db ?? 0)} dB.`);
  add("voice_speech_rate", "Speech rate", v.speech_rate, `Speaking at ${round1(v.speech_rate ?? 0)} syllables/sec.`);
  add("voice_pause_ratio", "Pause ratio", v.pause_ratio, `${Math.round((v.pause_ratio ?? 0) * 100)}% of the call was silence.`);

  return out;
}

interface ChannelDraft {
  channel: CompositeChannel;
  score: number;
  /** Positive point attributions that sum to `score`. */
  features: FeaturePoints[];
  /** Rows recorded as evidence only; they carry zero points by construction. */
  neutral: FeaturePoints[];
  /** True when `features` are additive penalties needing an explicit baseline row. */
  additive: boolean;
  primaryLabel?: string;
}

export function composeDistressScore(input: CompositeInput): CompositeResult {
  const now = input.now ?? new Date();

  const context = buildContext(input.context, now);

  // ── crisis override runs before composition and replaces it entirely ──────
  if (input.crisis) {
    const crisisContribution = 95 - COMPOSITE_BASE;
    const contribution: ScoreContribution = {
      channel: "clinical",
      feature: "crisis_override",
      feature_label: "Crisis override",
      raw_value: 1,
      weight: 1,
      contribution: crisisContribution,
      direction: "increases",
      evidence: input.crisis.reason,
    };

    return {
      score: 95,
      risk_level: "critical",
      base: COMPOSITE_BASE,
      components: {
        clinical: null,
        text: input.text.score,
        voice: input.voice?.vocal_stress_index ?? null,
        behavioural:
          input.behavioural != null ? 100 - input.behavioural.engagement_score : null,
        context: context.score,
      },
      channels: [
        {
          channel: "clinical",
          label: "Crisis override",
          base_weight: 1,
          weight: 1,
          score: 95,
          contribution: crisisContribution,
          features: [contribution],
        },
      ],
      active_channels: [
        { channel: "clinical", base_weight: 1, effective_weight: 1, score: 95 },
      ],
      contributions: [contribution],
      composite_version: `${COMPOSITE_VERSION}-crisis`,
      crisis_override: true,
      crisis_override_reason: input.crisis.reason,
      absent_channels: [],
      redistribution_note:
        "Crisis override — the weighted composite was bypassed because a single deterministic trigger fired.",
    };
  }

  const drafts: ChannelDraft[] = [];
  const absent: CompositeChannel[] = [];

  // ── clinical ──────────────────────────────────────────────────────────────
  const windowStart = now.getTime() - CLINICAL_WINDOW_DAYS * 86_400_000;
  const inWindow = (input.clinical ?? [])
    .filter((a) => new Date(a.created_at).getTime() >= windowStart)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const latestPerInstrument = new Map<string, ClinicalAssessmentInput>();
  for (const a of inWindow) {
    if (!latestPerInstrument.has(a.instrument)) latestPerInstrument.set(a.instrument, a);
  }

  const scoredInstruments = [...latestPerInstrument.values()]
    .map((a) => ({ assessment: a, normalised: normaliseClinicalScore(a) }))
    .filter((x): x is { assessment: ClinicalAssessmentInput; normalised: number } => x.normalised != null)
    .sort((a, b) => b.normalised - a.normalised);

  if (scoredInstruments.length) {
    // The worst screen in the window governs; the rest are recorded as context.
    const governing = scoredInstruments[0];
    const ageDays = Math.max(
      0,
      Math.round((now.getTime() - new Date(governing.assessment.created_at).getTime()) / 86_400_000)
    );
    drafts.push({
      channel: "clinical",
      score: governing.normalised,
      additive: false,
      primaryLabel: `${governing.assessment.instrument.toUpperCase()} screen`,
      features: [
        {
          feature: `clinical_${governing.assessment.instrument}`,
          feature_label: `${governing.assessment.instrument.toUpperCase()} screening result`,
          raw_value: governing.assessment.total_score,
          points: governing.normalised,
          evidence:
            `${governing.assessment.instrument.toUpperCase()}` +
            (governing.assessment.total_score != null && governing.assessment.max_score != null
              ? ` scored ${governing.assessment.total_score}/${governing.assessment.max_score}`
              : "") +
            (governing.assessment.severity_band ? ` (${governing.assessment.severity_band})` : "") +
            `, administered ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}.`,
        },
      ],
      neutral: scoredInstruments.slice(1).map((x) => ({
        feature: `clinical_${x.assessment.instrument}_secondary`,
        feature_label: `${x.assessment.instrument.toUpperCase()} (not governing)`,
        raw_value: x.assessment.total_score,
        points: 0,
        evidence: `${x.assessment.instrument.toUpperCase()} normalised to ${x.normalised}/100 — lower than the governing screen, so it adds nothing.`,
      })),
    });
  } else {
    absent.push("clinical");
  }

  // ── text sentiment (always present) ───────────────────────────────────────
  drafts.push({
    channel: "text_sentiment",
    score: clampNumber(input.text.score, 0, 100),
    additive: false,
    primaryLabel: "Conversation triage",
    features: [
      {
        feature: "text_triage_score",
        feature_label: "What they said, triaged",
        raw_value: input.text.score,
        points: clampNumber(input.text.score, 0, 100),
        evidence: (input.text.reasoning || "Conversation triage.").slice(0, 300),
      },
    ],
    neutral: (input.text.signals ?? []).slice(0, 6).map((s) => ({
      feature: `text_signal_${s.replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}`,
      feature_label: `Signal: ${s.replace(/_/g, " ")}`,
      raw_value: null,
      points: 0,
      evidence: `Screening flagged "${s.replace(/_/g, " ")}" in this conversation.`,
    })),
  });

  // ── vocal stress ──────────────────────────────────────────────────────────
  const voice = input.voice;
  const voiceUsable =
    voice != null &&
    voice.vocal_stress_index != null &&
    (voice.confidence ?? "").toLowerCase() !== "insufficient";

  if (voiceUsable && voice) {
    const index = clampNumber(voice.vocal_stress_index!, 0, 100);
    const deviation = voice.baseline_deviation;
    drafts.push({
      channel: "vocal_stress",
      score: index,
      additive: false,
      primaryLabel: "Vocal stress index",
      features: [
        {
          feature: "vocal_stress_index",
          feature_label: "Vocal stress index",
          raw_value: index,
          points: index,
          evidence:
            deviation != null
              ? `Vocal pitch ${round1(Math.abs(deviation))}σ ${deviation >= 0 ? "above" : "below"} this person's calm baseline (index ${index}/100, ${voice.confidence ?? "unrated"} confidence).`
              : `Vocal stress index ${index}/100 with no personal baseline yet (${voice.confidence ?? "unrated"} confidence).`,
        },
      ],
      neutral: voiceNeutralFeatures(voice),
    });
  } else {
    absent.push("vocal_stress");
  }

  // ── behavioural ───────────────────────────────────────────────────────────
  const behavioural = input.behavioural;
  if (behavioural && behavioural.prior_checkin_count >= 2) {
    const channelScore = clampNumber(100 - behavioural.engagement_score, 0, 100);
    drafts.push({
      channel: "behavioural",
      score: channelScore,
      additive: true,
      features: behavioural.penalties
        .filter((p) => p.points > 0)
        .map((p) => ({
          feature: p.key,
          feature_label: p.label,
          raw_value: p.raw_value,
          points: p.points,
          evidence: p.evidence,
        })),
      neutral: behavioural.penalties
        .filter((p) => p.points <= 0)
        .map((p) => ({
          feature: p.key,
          feature_label: p.label,
          raw_value: p.raw_value,
          points: 0,
          evidence: p.evidence,
        })),
    });
  } else {
    absent.push("behavioural");
  }

  // ── case context (always present) ─────────────────────────────────────────
  drafts.push({
    channel: "case_context",
    score: context.score,
    additive: true,
    features: context.features,
    neutral: context.neutral,
  });

  // ── weight redistribution ─────────────────────────────────────────────────
  // An absent channel is not zero distress, it is no information. Its weight is
  // shared across the channels that did report, in proportion to their own
  // weights, so the present channels still sum to 1.0.
  const weightSum = drafts.reduce((a, d) => a + CHANNEL_BASE_WEIGHTS[d.channel], 0);
  const effectiveWeight = (channel: CompositeChannel) =>
    CHANNEL_BASE_WEIGHTS[channel] / weightSum;

  const channels: CompositeChannelResult[] = [];
  const contributions: ScoreContribution[] = [];

  for (const draft of drafts) {
    const w = effectiveWeight(draft.channel);
    const channelContribution = w * (draft.score - COMPOSITE_BASE);
    const features: ScoreContribution[] = [];

    if (draft.additive) {
      // Additive channels start at zero, so the distance from the neutral
      // midpoint is an explicit row. Without it the feature rows would not sum
      // to the channel's contribution.
      features.push({
        channel: draft.channel,
        feature: `${draft.channel}_baseline`,
        feature_label: `${CHANNEL_LABELS[draft.channel]}: neutral baseline`,
        raw_value: COMPOSITE_BASE,
        weight: w,
        contribution: round1(-w * COMPOSITE_BASE),
        direction: "decreases",
        evidence: `This channel is scored by adding named stressors to zero, so it starts ${COMPOSITE_BASE} points below the neutral midpoint.`,
      });
      for (const f of draft.features) {
        features.push({
          channel: draft.channel,
          feature: f.feature,
          feature_label: f.feature_label,
          raw_value: f.raw_value,
          weight: w,
          contribution: round1(w * f.points),
          direction: f.points > 0 ? "increases" : f.points < 0 ? "decreases" : "neutral",
          evidence: f.evidence,
        });
      }
    } else {
      const f = draft.features[0];
      features.push({
        channel: draft.channel,
        feature: f.feature,
        feature_label: f.feature_label,
        raw_value: f.raw_value,
        weight: w,
        contribution: round1(channelContribution),
        direction:
          draft.score > COMPOSITE_BASE
            ? "increases"
            : draft.score < COMPOSITE_BASE
              ? "decreases"
              : "neutral",
        evidence: f.evidence,
      });
    }

    for (const n of draft.neutral) {
      features.push({
        channel: draft.channel,
        feature: n.feature,
        feature_label: n.feature_label,
        raw_value: n.raw_value,
        weight: w,
        contribution: 0,
        direction: "neutral",
        evidence: n.evidence,
      });
    }

    channels.push({
      channel: draft.channel,
      label: CHANNEL_LABELS[draft.channel],
      base_weight: CHANNEL_BASE_WEIGHTS[draft.channel],
      weight: Math.round(w * 1000) / 1000,
      score: Math.round(draft.score),
      contribution: round1(channelContribution),
      features,
    });

    contributions.push(...features);
  }

  const raw = drafts.reduce((a, d) => a + effectiveWeight(d.channel) * d.score, 0);
  const score = Math.round(clampNumber(raw, 0, 100));

  const byChannel = new Map(drafts.map((d) => [d.channel, d.score] as const));

  return {
    score,
    risk_level: riskFromScore(score),
    base: COMPOSITE_BASE,
    components: {
      clinical: byChannel.get("clinical") ?? null,
      text: Math.round(byChannel.get("text_sentiment") ?? input.text.score),
      voice: byChannel.get("vocal_stress") ?? null,
      behavioural: byChannel.get("behavioural") ?? null,
      context: Math.round(context.score),
    },
    channels,
    active_channels: drafts.map((d) => ({
      channel: d.channel,
      base_weight: CHANNEL_BASE_WEIGHTS[d.channel],
      effective_weight: Math.round(effectiveWeight(d.channel) * 1000) / 1000,
      score: Math.round(d.score),
    })),
    contributions,
    composite_version: COMPOSITE_VERSION,
    crisis_override: false,
    crisis_override_reason: null,
    absent_channels: absent,
    redistribution_note: absent.length
      ? `${absent.map((c) => CHANNEL_LABELS[c]).join(" and ")} had no data; that weight was redistributed across the ${drafts.length} reporting channels rather than scored as zero.`
      : "All five channels reported; base weights applied unchanged.",
  };
}

/**
 * Recompute the composite from channel scores alone, optionally overriding one
 * channel. Used for counterfactuals ("what if their voice were back at their
 * own calm baseline?") so the answer comes from the same arithmetic.
 */
export function recomposeFromChannels(
  channels: Array<{ channel: CompositeChannel; score: number }>,
  override?: { channel: CompositeChannel; score: number }
): number {
  if (!channels.length) return 0;
  const weightSum = channels.reduce((a, c) => a + CHANNEL_BASE_WEIGHTS[c.channel], 0);
  if (weightSum <= 0) return 0;

  const raw = channels.reduce((a, c) => {
    const value = override && override.channel === c.channel ? override.score : c.score;
    return a + (CHANNEL_BASE_WEIGHTS[c.channel] / weightSum) * value;
  }, 0);

  return Math.round(clampNumber(raw, 0, 100));
}
