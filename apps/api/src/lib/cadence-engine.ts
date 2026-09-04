/**
 * Care Cadence Engine.
 *
 * Two halves. The scheduling half decides when to reach out. The silence half
 * decides what it means when nobody answers — a missed contact is a clinical
 * signal, so it escalates a behavioural penalty and eventually raises an alert
 * of its own rather than quietly rescheduling.
 */

import type { Server as SocketServer } from "socket.io";
import { supabaseAdmin } from "./supabase";
import { safeQuery, warnOnce } from "./db-safe";
import { getExotelConfig, sendSms } from "./exotel";
import { sweepSlaBreaches } from "./intervention-engine";
import type { RiskLevel } from "@samvedna/shared-types";

export type CadenceTier = "intensive" | "active" | "routine" | "maintenance";

export type OutreachStatus = "scheduled" | "sent" | "responded" | "missed" | "cancelled";

export type OutreachGeneratedBy = "cadence" | "event" | "manual" | "escalation";

export const CADENCE_INTERVAL_HOURS: Record<CadenceTier, number> = {
  intensive: 24,
  active: 48,
  routine: 24 * 7,
  maintenance: 24 * 14,
};

export const CADENCE_TIER_LABELS: Record<CadenceTier, string> = {
  intensive: "Intensive — daily contact",
  active: "Active — every 48 hours",
  routine: "Routine — weekly",
  maintenance: "Maintenance — fortnightly",
};

/** Hours after `scheduled_for` before an unanswered contact counts as missed. */
export const MISSED_GRACE_HOURS = Number(process.env.OUTREACH_GRACE_HOURS ?? 36);

/** Consecutive misses at which disengagement becomes an alert in its own right. */
export const DISENGAGEMENT_ALERT_THRESHOLD = 3;

export interface OutreachRow {
  id: string;
  case_id: string;
  scheduled_for: string;
  channel: string;
  status: OutreachStatus;
  reason: string | null;
  generated_by: string | null;
  attempt_count: number | null;
  responded_at: string | null;
  checkin_id: string | null;
  created_at: string;
}

export function cadenceTierFrom(
  risk: RiskLevel,
  escalation: number,
  stableCheckinCount = 0
): CadenceTier {
  if (risk === "critical" || escalation >= 75) return "intensive";
  if (risk === "high" || escalation >= 55) return "active";
  if (risk === "moderate") return "routine";
  // Maintenance is earned: low risk alone isn't enough, it has to have held.
  return stableCheckinCount >= 3 ? "maintenance" : "routine";
}

export function cadenceIntervalDays(tier: CadenceTier): number {
  return CADENCE_INTERVAL_HOURS[tier] / 24;
}

/**
 * Behavioural penalty for consecutive missed contacts. Escalating, because the
 * third silence means something the first one didn't.
 */
export function missedOutreachPenalty(consecutiveMissed: number): number {
  if (consecutiveMissed <= 0) return 0;
  if (consecutiveMissed === 1) return 8;
  if (consecutiveMissed === 2) return 18;
  return 30;
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function emitOutreach(io: SocketServer | undefined, caseId: string, payload: unknown) {
  if (!io) return;
  io.to(`case:${caseId}`).emit("outreach_update", payload);
}

async function insertOutreach(row: {
  case_id: string;
  scheduled_for: string;
  channel: string;
  reason: string;
  generated_by: OutreachGeneratedBy;
}): Promise<OutreachRow | null> {
  const { data } = await safeQuery<OutreachRow>("outreach_schedule:insert", () =>
    supabaseAdmin
      .from("outreach_schedule")
      .insert({ ...row, status: "scheduled", attempt_count: 0 })
      .select()
      .single()
  );
  return data;
}

/** Skip an event outreach we have already booked for the same moment and reason. */
async function alreadyScheduled(
  caseId: string,
  scheduledFor: string,
  reason: string
): Promise<boolean> {
  const { data } = await safeQuery<{ id: string }[]>("outreach_schedule:dedup", () =>
    supabaseAdmin
      .from("outreach_schedule")
      .select("id")
      .eq("case_id", caseId)
      .eq("reason", reason)
      .in("status", ["scheduled", "sent", "responded"])
      .gte("scheduled_for", new Date(new Date(scheduledFor).getTime() - 3_600_000).toISOString())
      .lte("scheduled_for", new Date(new Date(scheduledFor).getTime() + 3_600_000).toISOString())
      .limit(1)
  );
  return Boolean(data?.length);
}

export interface CaseCadenceContext {
  id: string;
  status?: string | null;
  next_hearing_date?: string | null;
  relief_due_date?: string | null;
  relief_amount_sanctioned?: number | null;
  relief_amount_disbursed?: number | null;
}

/**
 * Event-driven outreach, scheduled independently of the risk tier: these are
 * predictable distress spikes with known dates, so they are booked whether or
 * not the person is currently scored as high risk.
 */
export async function scheduleEventOutreach(
  caseRow: CaseCadenceContext,
  io?: SocketServer
): Promise<OutreachRow[]> {
  const created: OutreachRow[] = [];
  const now = Date.now();

  const book = async (
    scheduledFor: Date,
    channel: string,
    reason: string
  ): Promise<void> => {
    if (scheduledFor.getTime() <= now) return;
    const iso = scheduledFor.toISOString();
    if (await alreadyScheduled(caseRow.id, iso, reason)) return;
    const row = await insertOutreach({
      case_id: caseRow.id,
      scheduled_for: iso,
      channel,
      reason,
      generated_by: "event",
    });
    if (row) {
      created.push(row);
      emitOutreach(io, caseRow.id, { type: "scheduled", outreach: row });
    }
  };

  if (caseRow.next_hearing_date) {
    const hearing = new Date(caseRow.next_hearing_date);
    const hearingLabel = caseRow.next_hearing_date;
    await book(
      new Date(hearing.getTime() - 48 * 3_600_000),
      "helpline_callback",
      `Pre-hearing support call — hearing listed for ${hearingLabel}`
    );
    await book(
      new Date(hearing.getTime() + 24 * 3_600_000),
      "helpline_callback",
      `Post-hearing outcome check — hearing was on ${hearingLabel}`
    );
  }

  const sanctioned = caseRow.relief_amount_sanctioned ?? null;
  const disbursed = caseRow.relief_amount_disbursed ?? 0;
  if (caseRow.relief_due_date && sanctioned != null && disbursed < sanctioned) {
    await book(
      new Date(new Date(caseRow.relief_due_date).getTime() + 24 * 3_600_000),
      "sms",
      `Relief payment shortfall follow-up — ₹${(sanctioned - disbursed).toLocaleString("en-IN")} still undisbursed after the ${caseRow.relief_due_date} due date`
    );
  }

  return created;
}

export async function scheduleStatusTransitionOutreach(
  caseId: string,
  fromStatus: string,
  toStatus: string,
  io?: SocketServer
): Promise<OutreachRow | null> {
  const reason = `Case stage moved from ${fromStatus.replace(/_/g, " ")} to ${toStatus.replace(/_/g, " ")} — orientation call on what changes next`;
  const scheduledFor = hoursFromNow(24);
  if (await alreadyScheduled(caseId, scheduledFor, reason)) return null;

  const row = await insertOutreach({
    case_id: caseId,
    scheduled_for: scheduledFor,
    channel: "chat",
    reason,
    generated_by: "event",
  });
  if (row) emitOutreach(io, caseId, { type: "scheduled", outreach: row });
  return row;
}

export async function scheduleRelapseCheck(
  caseId: string,
  alertId: string,
  io?: SocketServer
): Promise<OutreachRow | null> {
  const reason = `Relapse check — 7 days after alert ${alertId.slice(0, 8)} was resolved`;
  const scheduledFor = hoursFromNow(7 * 24);
  if (await alreadyScheduled(caseId, scheduledFor, reason)) return null;

  const row = await insertOutreach({
    case_id: caseId,
    scheduled_for: scheduledFor,
    channel: "chat",
    reason,
    generated_by: "event",
  });
  if (row) emitOutreach(io, caseId, { type: "scheduled", outreach: row });
  return row;
}

export interface CadenceUpdate {
  tier: CadenceTier;
  interval_hours: number;
  next_outreach_at: string | null;
  event_outreach_created: number;
}

/** Recompute the tier after a score and re-book the next routine contact. */
export async function upsertCadenceAfterScore(opts: {
  caseId: string;
  risk: RiskLevel;
  escalation: number;
  stableCheckinCount?: number;
  caseRow?: CaseCadenceContext;
  io?: SocketServer;
}): Promise<CadenceUpdate> {
  const tier = cadenceTierFrom(opts.risk, opts.escalation, opts.stableCheckinCount ?? 0);
  const hours = CADENCE_INTERVAL_HOURS[tier];
  const scheduledFor = hoursFromNow(hours);

  await safeQuery("cases:cadence_update", () =>
    supabaseAdmin
      .from("cases")
      .update({
        cadence_tier: tier,
        last_contact_at: new Date().toISOString(),
        consecutive_missed_outreach: 0,
      })
      .eq("id", opts.caseId)
      .select("id")
  );

  // Only routine cadence rows are superseded; event rows keep their own dates.
  await safeQuery("outreach_schedule:cancel_cadence", () =>
    supabaseAdmin
      .from("outreach_schedule")
      .update({ status: "cancelled" })
      .eq("case_id", opts.caseId)
      .eq("status", "scheduled")
      .eq("generated_by", "cadence")
      .select("id")
  );

  const row = await insertOutreach({
    case_id: opts.caseId,
    scheduled_for: scheduledFor,
    channel: "chat",
    reason: `Risk-adaptive cadence — ${CADENCE_TIER_LABELS[tier]}`,
    generated_by: "cadence",
  });

  if (row) emitOutreach(opts.io, opts.caseId, { type: "scheduled", outreach: row });

  let eventCount = 0;
  if (opts.caseRow) {
    const events = await scheduleEventOutreach(opts.caseRow, opts.io);
    eventCount = events.length;
  }

  return {
    tier,
    interval_hours: hours,
    next_outreach_at: row?.scheduled_for ?? scheduledFor,
    event_outreach_created: eventCount,
  };
}

/** Mark a scheduled/sent contact answered and reset the silence counter. */
export async function markOutreachResponded(
  outreachId: string,
  checkinId?: string | null,
  io?: SocketServer
): Promise<OutreachRow | null> {
  const { data } = await safeQuery<OutreachRow>("outreach_schedule:respond", () =>
    supabaseAdmin
      .from("outreach_schedule")
      .update({
        status: "responded",
        responded_at: new Date().toISOString(),
        checkin_id: checkinId ?? null,
      })
      .eq("id", outreachId)
      .select()
      .single()
  );

  if (data) {
    await safeQuery("cases:reset_missed", () =>
      supabaseAdmin
        .from("cases")
        .update({
          consecutive_missed_outreach: 0,
          last_contact_at: new Date().toISOString(),
        })
        .eq("id", data.case_id)
        .select("id")
    );
    emitOutreach(io, data.case_id, { type: "responded", outreach: data });
  }

  return data;
}

async function deliverOutreach(row: OutreachRow): Promise<{ delivered: boolean; note: string }> {
  const message =
    "Samvedna: your support worker is checking in. Reply to this message or call NHAA 14566 any time. Tele-MANAS 14416.";

  if (!getExotelConfig()) {
    return {
      delivered: false,
      note: `[outreach] simulated ${row.channel} to case ${row.case_id} — Exotel not configured`,
    };
  }

  if (row.channel !== "sms") {
    return {
      delivered: false,
      note: `[outreach] channel ${row.channel} has no automated sender — queued for a human`,
    };
  }

  const { data: caseRow } = await safeQuery<{ profiles: { phone_number: string | null } | null }>(
    "cases:outreach_phone",
    () =>
      supabaseAdmin
        .from("cases")
        .select("profiles!cases_victim_id_fkey(phone_number)")
        .eq("id", row.case_id)
        .single()
  );

  const profile = Array.isArray(caseRow?.profiles) ? caseRow?.profiles[0] : caseRow?.profiles;
  const phone = profile?.phone_number;
  if (!phone) {
    return { delivered: false, note: `[outreach] no phone on file for case ${row.case_id}` };
  }

  try {
    await sendSms(phone, message, `outreach:${row.id}`);
    return { delivered: true, note: `[outreach] SMS sent for case ${row.case_id}` };
  } catch (err) {
    return {
      delivered: false,
      note: `[outreach] SMS failed for case ${row.case_id}: ${err instanceof Error ? err.message : err}`,
    };
  }
}

async function raiseDisengagementAlert(
  caseId: string,
  consecutiveMissed: number,
  io?: SocketServer
): Promise<boolean> {
  const reason = "disengagement — 3 consecutive missed contacts";

  const { data: openAlerts } = await safeQuery<{ id: string }[]>("alerts:disengagement_dedup", () =>
    supabaseAdmin
      .from("alerts")
      .select("id")
      .eq("case_id", caseId)
      .in("status", ["open", "acknowledged"])
      .gte("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
      .limit(1)
  );
  if (openAlerts?.length) return false;

  const { data: caseRow } = await safeQuery<{
    assigned_counsellor_id: string | null;
    assigned_official_id: string | null;
    case_number: string;
  }>("cases:disengagement_assignee", () =>
    supabaseAdmin
      .from("cases")
      .select("assigned_counsellor_id, assigned_official_id, case_number")
      .eq("id", caseId)
      .single()
  );

  const assignee = caseRow?.assigned_counsellor_id ?? caseRow?.assigned_official_id ?? null;

  await safeQuery("case_timeline_events:disengagement", () =>
    supabaseAdmin
      .from("case_timeline_events")
      .insert({
        case_id: caseId,
        event_type: "disengagement_alert",
        description: `Gone quiet — ${consecutiveMissed} consecutive missed contacts`,
        created_by: assignee,
      })
      .select("id")
  );

  if (!assignee) return false;

  // alerts.distress_score_id is NOT NULL, so a disengagement alert borrows the
  // most recent score for the case. Without one we keep the timeline event only.
  const { data: latestScore } = await safeQuery<{ id: string }[]>("distress_scores:latest", () =>
    supabaseAdmin
      .from("distress_scores")
      .select("id")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(1)
  );
  const scoreId = latestScore?.[0]?.id;
  if (!scoreId) return false;

  const payload: Record<string, unknown> = {
    case_id: caseId,
    distress_score_id: scoreId,
    severity: "high" as RiskLevel,
    status: "open",
    assigned_to: assignee,
    reason,
  };

  let inserted = await safeQuery<{ id: string }>("alerts:disengagement", () =>
    supabaseAdmin.from("alerts").insert(payload).select("id").single()
  );

  if (!inserted.data && inserted.degraded) {
    delete payload.reason;
    inserted = await safeQuery<{ id: string }>("alerts:disengagement_minimal", () =>
      supabaseAdmin.from("alerts").insert(payload).select("id").single()
    );
  }

  if (inserted.data && io) {
    io.to(`case:${caseId}`).emit("outreach_update", {
      type: "disengagement_alert",
      case_id: caseId,
      alert_id: inserted.data.id,
      reason,
      consecutive_missed: consecutiveMissed,
    });
    io.to(`user:${assignee}`).emit("outreach_update", {
      type: "disengagement_alert",
      case_id: caseId,
      case_number: caseRow?.case_number,
      alert_id: inserted.data.id,
      reason,
    });
  }

  return Boolean(inserted.data);
}

export interface CadenceTickResult {
  sent: number;
  missed: number;
  disengagement_alerts: number;
  relapse_checks: number;
  status_transitions: number;
  sla_breaches: number;
  degraded: boolean;
}

/** Last status we saw per case, so a transition can be detected without a trigger. */
const lastSeenStatus = new Map<string, string>();

async function detectStatusTransitions(io?: SocketServer): Promise<number> {
  const { data, degraded } = await safeQuery<{ id: string; status: string }[]>(
    "cases:status_scan",
    () => supabaseAdmin.from("cases").select("id, status").neq("status", "closed").limit(500)
  );
  if (degraded || !data) return 0;

  let count = 0;
  for (const row of data) {
    const previous = lastSeenStatus.get(row.id);
    lastSeenStatus.set(row.id, row.status);
    // First sighting only seeds the map — we never schedule on process start.
    if (previous && previous !== row.status) {
      const created = await scheduleStatusTransitionOutreach(row.id, previous, row.status, io);
      if (created) count += 1;
    }
  }
  return count;
}

async function sweepResolvedAlertRelapseChecks(io?: SocketServer): Promise<number> {
  const { data } = await safeQuery<{ id: string; case_id: string; resolved_at: string }[]>(
    "alerts:resolved_sweep",
    () =>
      supabaseAdmin
        .from("alerts")
        .select("id, case_id, resolved_at")
        .eq("status", "resolved")
        .not("resolved_at", "is", null)
        .gte("resolved_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
        .limit(100)
  );

  let count = 0;
  for (const alert of data ?? []) {
    const created = await scheduleRelapseCheck(alert.case_id, alert.id, io);
    if (created) count += 1;
  }
  return count;
}

/** Reentrancy guard — a slow tick must never overlap the next one. */
let ticking = false;

export async function processDueOutreach(io?: SocketServer): Promise<CadenceTickResult> {
  const result: CadenceTickResult = {
    sent: 0,
    missed: 0,
    disengagement_alerts: 0,
    relapse_checks: 0,
    status_transitions: 0,
    sla_breaches: 0,
    degraded: false,
  };

  const nowIso = new Date().toISOString();

  const due = await safeQuery<OutreachRow[]>("outreach_schedule:due", () =>
    supabaseAdmin
      .from("outreach_schedule")
      .select("*")
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(50)
  );

  if (due.degraded) {
    result.degraded = true;
    return result;
  }

  for (const row of due.data ?? []) {
    const delivery = await deliverOutreach(row);
    console.log(delivery.note);

    const { data: updated } = await safeQuery<OutreachRow>("outreach_schedule:mark_sent", () =>
      supabaseAdmin
        .from("outreach_schedule")
        .update({ status: "sent", attempt_count: (row.attempt_count ?? 0) + 1 })
        .eq("id", row.id)
        .select()
        .single()
    );

    result.sent += 1;
    emitOutreach(io, row.case_id, {
      type: "sent",
      outreach: updated ?? row,
      delivered: delivery.delivered,
    });
  }

  // ── silence detection ─────────────────────────────────────────────────────
  const graceCutoff = new Date(Date.now() - MISSED_GRACE_HOURS * 3_600_000).toISOString();
  const stale = await safeQuery<OutreachRow[]>("outreach_schedule:stale", () =>
    supabaseAdmin
      .from("outreach_schedule")
      .select("*")
      .eq("status", "sent")
      .is("responded_at", null)
      .lte("scheduled_for", graceCutoff)
      .limit(50)
  );

  for (const row of stale.data ?? []) {
    await safeQuery("outreach_schedule:mark_missed", () =>
      supabaseAdmin
        .from("outreach_schedule")
        .update({ status: "missed", attempt_count: (row.attempt_count ?? 0) + 1 })
        .eq("id", row.id)
        .select("id")
    );
    result.missed += 1;

    const { data: caseRow } = await safeQuery<{ consecutive_missed_outreach: number | null }>(
      "cases:missed_counter",
      () =>
        supabaseAdmin
          .from("cases")
          .select("consecutive_missed_outreach")
          .eq("id", row.case_id)
          .single()
    );

    const consecutive = (caseRow?.consecutive_missed_outreach ?? 0) + 1;

    await safeQuery("cases:increment_missed", () =>
      supabaseAdmin
        .from("cases")
        .update({ consecutive_missed_outreach: consecutive })
        .eq("id", row.case_id)
        .select("id")
    );

    emitOutreach(io, row.case_id, {
      type: "missed",
      outreach: { ...row, status: "missed" as OutreachStatus },
      consecutive_missed: consecutive,
      behavioural_penalty: missedOutreachPenalty(consecutive),
    });

    if (consecutive >= DISENGAGEMENT_ALERT_THRESHOLD) {
      const raised = await raiseDisengagementAlert(row.case_id, consecutive, io);
      if (raised) result.disengagement_alerts += 1;
    }
  }

  result.status_transitions = await detectStatusTransitions(io);
  result.relapse_checks = await sweepResolvedAlertRelapseChecks(io);
  result.sla_breaches = await sweepSlaBreaches();

  return result;
}

let tickHandle: NodeJS.Timeout | null = null;

/**
 * Registered from index.ts. Guarded so a tick that outlives its 60s window
 * cannot overlap the next one, and so a thrown error kills the tick rather
 * than the process.
 */
export function startCadenceTick(io?: SocketServer, intervalMs = 60_000): NodeJS.Timeout {
  if (tickHandle) return tickHandle;

  tickHandle = setInterval(() => {
    if (ticking) {
      warnOnce("cadence:overlap", "cadence tick still running after 60s — skipping this cycle");
      return;
    }
    ticking = true;
    processDueOutreach(io)
      .then((r) => {
        if (r.sent || r.missed || r.disengagement_alerts || r.sla_breaches) {
          console.log(
            `[cadence] sent=${r.sent} missed=${r.missed} disengagement=${r.disengagement_alerts} sla=${r.sla_breaches}`
          );
        }
      })
      .catch((err) => console.warn("[cadence] tick failed", err instanceof Error ? err.message : err))
      .finally(() => {
        ticking = false;
      });
  }, intervalMs);

  return tickHandle;
}

export function stopCadenceTick() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

export interface GoneQuietCase {
  id: string;
  case_number: string;
  case_type: string;
  status: string;
  district: string | null;
  cadence_tier: CadenceTier | null;
  last_contact_at: string | null;
  consecutive_missed_outreach: number;
  /** Kept for the existing counsellor UI, which reads missed_count. */
  missed_count: number;
  days_since_contact: number | null;
  cadence_interval_days: number;
  overdue_multiple: number | null;
  severity_rank: number;
  victim?: { full_name?: string } | null;
  reason: string;
  honesty: string;
}

/**
 * Cases that have gone quiet: two or more consecutive missed contacts, or no
 * contact at all in more than twice their own cadence interval.
 */
export async function getGoneQuietCases(caseIds?: string[] | null): Promise<GoneQuietCase[]> {
  const { data: cases, degraded } = await safeQuery<
    Array<{
      id: string;
      case_number: string;
      case_type: string;
      status: string;
      district: string | null;
      cadence_tier: string | null;
      last_contact_at: string | null;
      consecutive_missed_outreach: number | null;
      victim: { full_name?: string } | Array<{ full_name?: string }> | null;
    }>
  >("cases:gone_quiet", () => {
    let query = supabaseAdmin
      .from("cases")
      .select(
        "id, case_number, case_type, status, district, cadence_tier, last_contact_at, consecutive_missed_outreach, victim:profiles!cases_victim_id_fkey(full_name)"
      )
      .neq("status", "closed");
    if (caseIds) {
      query = query.in("id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"]);
    }
    return query.limit(500);
  });

  if (degraded || !cases) return [];

  // Missed counts still come from the schedule so the number is real even when
  // the counter column was never backfilled.
  const { data: missedRows } = await safeQuery<{ case_id: string }[]>(
    "outreach_schedule:missed_counts",
    () => supabaseAdmin.from("outreach_schedule").select("case_id").eq("status", "missed")
  );

  const missedByCase = new Map<string, number>();
  for (const row of missedRows ?? []) {
    missedByCase.set(row.case_id, (missedByCase.get(row.case_id) ?? 0) + 1);
  }

  const now = Date.now();
  const out: GoneQuietCase[] = [];

  for (const c of cases) {
    const tier = (c.cadence_tier ?? "routine") as CadenceTier;
    const intervalDays = cadenceIntervalDays(tier);
    const consecutive = c.consecutive_missed_outreach ?? 0;
    const missedCount = missedByCase.get(c.id) ?? 0;
    const daysSinceContact = c.last_contact_at
      ? (now - new Date(c.last_contact_at).getTime()) / 86_400_000
      : null;
    const overdueMultiple = daysSinceContact != null ? daysSinceContact / intervalDays : null;

    const byMisses = consecutive >= 2 || missedCount >= 2;
    const bySilence = overdueMultiple != null && overdueMultiple > 2;
    if (!byMisses && !bySilence) continue;

    const reasons: string[] = [];
    if (byMisses) {
      reasons.push(
        `${Math.max(consecutive, missedCount)} missed scheduled contact${Math.max(consecutive, missedCount) === 1 ? "" : "s"}`
      );
    }
    if (bySilence && daysSinceContact != null) {
      reasons.push(
        `${Math.round(daysSinceContact)} days without contact on a ${intervalDays}-day ${tier} cadence`
      );
    }

    out.push({
      id: c.id,
      case_number: c.case_number,
      case_type: c.case_type,
      status: c.status,
      district: c.district,
      cadence_tier: tier,
      last_contact_at: c.last_contact_at,
      consecutive_missed_outreach: consecutive,
      missed_count: Math.max(consecutive, missedCount),
      days_since_contact: daysSinceContact != null ? Math.round(daysSinceContact) : null,
      cadence_interval_days: intervalDays,
      overdue_multiple: overdueMultiple != null ? Math.round(overdueMultiple * 10) / 10 : null,
      severity_rank:
        missedOutreachPenalty(Math.max(consecutive, missedCount)) +
        Math.round((overdueMultiple ?? 0) * 5),
      victim: Array.isArray(c.victim) ? c.victim[0] : c.victim,
      reason: reasons.join("; "),
      honesty: "LIVE disengagement signal from the outreach schedule — silence is treated as data.",
    });
  }

  out.sort((a, b) => b.severity_rank - a.severity_rank);
  return out;
}

/** Legacy helper kept for callers that only need the ids. */
export async function getGoneQuietCaseIds(): Promise<string[]> {
  return (await getGoneQuietCases()).map((c) => c.id);
}
