/**
 * Behavioural engagement channel.
 *
 * Every baseline here is the person's own history — a 40-word check-in is
 * withdrawal from someone who normally writes 200 words and perfectly normal
 * from someone who never writes more than 50. Global constants would flag the
 * second person forever and never notice the first one going quiet.
 */

import { supabaseAdmin } from "./supabase";
import { safeQuery, clampNumber } from "./db-safe";
import { CADENCE_INTERVAL_HOURS, type CadenceTier } from "./cadence-engine";

export interface EngagementClientMetrics {
  response_latency_seconds?: number | null;
  session_duration_seconds?: number | null;
  turns_in_session?: number | null;
  abandoned?: boolean | null;
}

export interface EngagementPenalty {
  key: string;
  label: string;
  /** Points of behavioural distress this term added (0 = no penalty). */
  points: number;
  raw_value: number | null;
  evidence: string;
}

export interface EngagementBaselines {
  message_char_baseline: number | null;
  latency_mean_seconds: number | null;
  latency_std_seconds: number | null;
  typical_hour: number | null;
  cadence_interval_days: number;
}

export interface EngagementMetrics {
  case_id: string;
  checkin_id: string;
  response_latency_seconds: number | null;
  message_char_count: number;
  message_word_count: number;
  session_duration_seconds: number | null;
  turns_in_session: number | null;
  abandoned: boolean;
  hour_of_day: number;
  day_of_week: number;
  days_since_last_checkin: number | null;
  missed_outreach_count_30d: number;
  engagement_score: number;
}

export interface EngagementResult {
  engagement_score: number;
  /** 0-100 behavioural distress = the clamped penalty total. */
  penalty_total: number;
  penalties: EngagementPenalty[];
  metrics: EngagementMetrics;
  baselines: EngagementBaselines;
  prior_checkin_count: number;
  persisted: boolean;
}

export interface EngagementCheckinInput {
  id: string;
  raw_transcript: string;
  created_at?: string | null;
}

const THIRTY_DAYS_MS = 30 * 86_400_000;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], mu: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((a, v) => a + (v - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Hours apart on a 24h clock, so 23:00 and 01:00 are 2 hours, not 22. */
function circadianDrift(hour: number, baseline: number): number {
  const diff = Math.abs(hour - baseline);
  return Math.min(diff, 24 - diff);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function computeEngagement(
  caseId: string,
  checkin: EngagementCheckinInput,
  clientMetrics: EngagementClientMetrics = {}
): Promise<EngagementResult> {
  const now = checkin.created_at ? new Date(checkin.created_at) : new Date();
  const since30d = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();

  const charCount = checkin.raw_transcript?.length ?? 0;
  const wordCount = checkin.raw_transcript?.trim()
    ? checkin.raw_transcript.trim().split(/\s+/).length
    : 0;

  // ── the person's own history ───────────────────────────────────────────────
  const { data: priorCheckins } = await safeQuery<
    { id: string; raw_transcript: string | null; created_at: string }[]
  >("checkins:history", () =>
    supabaseAdmin
      .from("checkins")
      .select("id, raw_transcript, created_at")
      .eq("case_id", caseId)
      .neq("id", checkin.id)
      .order("created_at", { ascending: false })
      .limit(40)
  );

  const history = priorCheckins ?? [];
  const priorCount = history.length;

  const { data: priorMetrics } = await safeQuery<
    { response_latency_seconds: number | null; abandoned: boolean | null; message_char_count: number | null }[]
  >("engagement_metrics:history", () =>
    supabaseAdmin
      .from("engagement_metrics")
      .select("response_latency_seconds, abandoned, message_char_count")
      .eq("case_id", caseId)
      .gte("created_at", since30d)
      .order("created_at", { ascending: false })
      .limit(60)
  );

  const { data: outreach30d } = await safeQuery<{ status: string }[]>(
    "outreach_schedule:30d",
    () =>
      supabaseAdmin
        .from("outreach_schedule")
        .select("status")
        .eq("case_id", caseId)
        .gte("scheduled_for", since30d)
  );

  const { data: caseRow } = await safeQuery<{ cadence_tier: string | null }>(
    "cases:cadence_tier",
    () => supabaseAdmin.from("cases").select("cadence_tier").eq("id", caseId).single()
  );

  const tier = (caseRow?.cadence_tier ?? "routine") as CadenceTier;
  const cadenceIntervalDays =
    (CADENCE_INTERVAL_HOURS[tier] ?? CADENCE_INTERVAL_HOURS.routine) / 24;

  const lastCheckinAt = history[0]?.created_at ?? null;
  const daysSinceLast = lastCheckinAt
    ? (now.getTime() - new Date(lastCheckinAt).getTime()) / 86_400_000
    : null;

  const resolvedOutreach = (outreach30d ?? []).filter((o) =>
    ["responded", "missed"].includes(o.status)
  );
  const missedCount = (outreach30d ?? []).filter((o) => o.status === "missed").length;
  const missedRatio = resolvedOutreach.length ? missedCount / resolvedOutreach.length : 0;

  const charBaselineSource = [
    ...(priorMetrics ?? []).map((m) => m.message_char_count).filter((n): n is number => n != null),
    ...history.map((h) => h.raw_transcript?.length ?? 0),
  ].filter((n) => n > 0);
  const charBaseline = charBaselineSource.length >= 2 ? mean(charBaselineSource) : null;

  const latencies = (priorMetrics ?? [])
    .map((m) => m.response_latency_seconds)
    .filter((n): n is number => n != null && n >= 0);
  const latencyMean = latencies.length >= 3 ? mean(latencies) : null;
  const latencyStd = latencyMean != null ? stdDev(latencies, latencyMean) : null;

  const hours = history.map((h) => new Date(h.created_at).getHours());
  const typicalHour = hours.length >= 3 ? median(hours) : null;

  const abandonedRows = (priorMetrics ?? []).filter((m) => m.abandoned === true).length;
  const abandonmentRate = priorMetrics?.length ? abandonedRows / priorMetrics.length : 0;

  // ── penalty terms ─────────────────────────────────────────────────────────
  const penalties: EngagementPenalty[] = [];

  const missedPoints = 30 * clampNumber(missedRatio, 0, 1);
  penalties.push({
    key: "missed_ratio_30d",
    label: "Missed scheduled contacts (30d)",
    points: round1(missedPoints),
    raw_value: round1(missedRatio),
    evidence: resolvedOutreach.length
      ? `${missedCount} of ${resolvedOutreach.length} scheduled contacts in the last 30 days went unanswered.`
      : "No scheduled contacts have come due in the last 30 days.",
  });

  const lengthRatio =
    charBaseline && charBaseline > 0 ? clampNumber(charCount / charBaseline, 0, 1) : 1;
  const lengthPoints = 20 * (1 - lengthRatio);
  penalties.push({
    key: "message_length_vs_baseline",
    label: "Message length against own baseline",
    points: round1(lengthPoints),
    raw_value: charCount,
    evidence: charBaseline
      ? `${charCount} characters against this person's own average of ${Math.round(charBaseline)} — ${Math.round(lengthRatio * 100)}% of their usual.`
      : "Not enough history yet to know this person's usual message length.",
  });

  const abandonPoints = 15 * clampNumber(abandonmentRate, 0, 1);
  penalties.push({
    key: "abandonment_rate_30d",
    label: "Abandoned sessions (30d)",
    points: round1(abandonPoints),
    raw_value: round1(abandonmentRate),
    evidence: priorMetrics?.length
      ? `${abandonedRows} of ${priorMetrics.length} recent sessions were left mid-conversation.`
      : "No session-completion history recorded yet.",
  });

  const overdueDays =
    daysSinceLast != null ? Math.max(0, daysSinceLast - cadenceIntervalDays) : 0;
  const overduePoints = 15 * clampNumber(overdueDays / cadenceIntervalDays, 0, 1);
  penalties.push({
    key: "overdue_vs_cadence",
    label: "Overdue against own care cadence",
    points: round1(overduePoints),
    raw_value: daysSinceLast != null ? round1(daysSinceLast) : null,
    evidence:
      daysSinceLast == null
        ? "First recorded check-in for this case."
        : overdueDays > 0
          ? `${round1(daysSinceLast)} days since the last check-in against a ${round1(cadenceIntervalDays)}-day ${tier} cadence — ${round1(overdueDays)} days overdue.`
          : `Last check-in ${round1(daysSinceLast)} days ago, within the ${round1(cadenceIntervalDays)}-day ${tier} cadence.`,
  });

  const latency = clientMetrics.response_latency_seconds ?? null;
  // z is clamped to [0,3] and rescaled so this term maxes out at its 10-point
  // coefficient like every other term, rather than dominating the sum.
  let latencyZ = 0;
  if (latency != null && latencyMean != null && latencyStd != null && latencyStd > 0) {
    latencyZ = clampNumber((latency - latencyMean) / latencyStd, 0, 3) / 3;
  }
  const latencyPoints = 10 * latencyZ;
  penalties.push({
    key: "response_latency_z",
    label: "Reply delay against own baseline",
    points: round1(latencyPoints),
    raw_value: latency,
    evidence:
      latency == null
        ? "No reply-latency measurement for this check-in."
        : latencyMean == null
          ? `Replied in ${Math.round(latency)}s; not enough history to compare.`
          : `Replied in ${Math.round(latency)}s against a personal average of ${Math.round(latencyMean)}s.`,
  });

  const hourOfDay = now.getHours();
  const drift = typicalHour != null ? circadianDrift(hourOfDay, typicalHour) : 0;
  const circadianPoints = 10 * clampNumber(drift / 12, 0, 1);
  penalties.push({
    key: "circadian_drift",
    label: "Contact time drift",
    points: round1(circadianPoints),
    raw_value: hourOfDay,
    evidence:
      typicalHour == null
        ? "Not enough history to establish a usual contact hour."
        : `Reached out at ${hourOfDay}:00 against a usual ${Math.round(typicalHour)}:00 — ${round1(drift)}h drift.`,
  });

  const penaltyTotal = clampNumber(
    penalties.reduce((a, p) => a + p.points, 0),
    0,
    100
  );
  const engagementScore = Math.round(100 - penaltyTotal);

  const metrics: EngagementMetrics = {
    case_id: caseId,
    checkin_id: checkin.id,
    response_latency_seconds: latency,
    message_char_count: charCount,
    message_word_count: wordCount,
    session_duration_seconds: clientMetrics.session_duration_seconds ?? null,
    turns_in_session: clientMetrics.turns_in_session ?? null,
    abandoned: clientMetrics.abandoned === true,
    hour_of_day: hourOfDay,
    day_of_week: now.getDay(),
    days_since_last_checkin: daysSinceLast != null ? round1(daysSinceLast) : null,
    missed_outreach_count_30d: missedCount,
    engagement_score: engagementScore,
  };

  // checkin_id is UNIQUE — a re-run of the pipeline must not duplicate the row.
  const { data: persisted } = await safeQuery<{ id: string }>("engagement_metrics:upsert", () =>
    supabaseAdmin
      .from("engagement_metrics")
      .upsert(metrics, { onConflict: "checkin_id" })
      .select("id")
      .single()
  );

  return {
    engagement_score: engagementScore,
    penalty_total: round1(penaltyTotal),
    penalties,
    metrics,
    baselines: {
      message_char_baseline: charBaseline != null ? Math.round(charBaseline) : null,
      latency_mean_seconds: latencyMean != null ? Math.round(latencyMean) : null,
      latency_std_seconds: latencyStd != null ? Math.round(latencyStd) : null,
      typical_hour: typicalHour,
      cadence_interval_days: round1(cadenceIntervalDays),
    },
    prior_checkin_count: priorCount,
    persisted: Boolean(persisted),
  };
}
