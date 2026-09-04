import { supabaseAdmin } from "./supabase";
import type { RiskLevel } from "@samvedna/shared-types";

export type CadenceTier = "intensive" | "active" | "routine" | "maintenance";

export function cadenceTierFrom(risk: RiskLevel, escalation: number): CadenceTier {
  if (risk === "critical" || escalation >= 75) return "intensive";
  if (risk === "high" || escalation >= 55) return "active";
  if (risk === "moderate") return "routine";
  return "maintenance";
}

const INTERVAL_HOURS: Record<CadenceTier, number> = {
  intensive: 24,
  active: 48,
  routine: 24 * 7,
  maintenance: 24 * 14,
};

/** After scoring: set cadence_tier and schedule next outreach. */
export async function upsertCadenceAfterScore(opts: {
  caseId: string;
  risk: RiskLevel;
  escalation: number;
  nextHearingDate?: string | null;
}) {
  const tier = cadenceTierFrom(opts.risk, opts.escalation);
  const hours = INTERVAL_HOURS[tier];
  const scheduled = new Date(Date.now() + hours * 3600 * 1000);

  await supabaseAdmin
    .from("cases")
    .update({ cadence_tier: tier, last_contact_at: new Date().toISOString() })
    .eq("id", opts.caseId);

  // Cancel prior scheduled open rows
  await supabaseAdmin
    .from("outreach_schedule")
    .update({ status: "cancelled" })
    .eq("case_id", opts.caseId)
    .eq("status", "scheduled");

  await supabaseAdmin.from("outreach_schedule").insert({
    case_id: opts.caseId,
    scheduled_for: scheduled.toISOString(),
    channel: "chat",
    status: "scheduled",
    reason: `Risk-adaptive cadence (${tier})`,
    generated_by: "cadence",
  });

  if (opts.nextHearingDate) {
    const hearing = new Date(opts.nextHearingDate);
    const pre = new Date(hearing.getTime() - 48 * 3600 * 1000);
    if (pre.getTime() > Date.now()) {
      await supabaseAdmin.from("outreach_schedule").insert({
        case_id: opts.caseId,
        scheduled_for: pre.toISOString(),
        channel: "helpline_callback",
        status: "scheduled",
        reason: "Pre-hearing check-in (48h before)",
        generated_by: "event",
      });
    }
  }
}

export async function processDueOutreach(): Promise<{
  sent: number;
  missed: number;
}> {
  const now = new Date();
  let sent = 0;
  let missed = 0;

  const { data: due } = await supabaseAdmin
    .from("outreach_schedule")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .limit(50);

  for (const row of due ?? []) {
    // Mark sent (simulated channel — Exotel when configured)
    await supabaseAdmin
      .from("outreach_schedule")
      .update({ status: "sent", attempt_count: (row.attempt_count ?? 0) + 1 })
      .eq("id", row.id);
    sent += 1;
  }

  // Missed: sent > grace (36h) with no response
  const grace = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const { data: stale } = await supabaseAdmin
    .from("outreach_schedule")
    .select("*")
    .eq("status", "sent")
    .lte("scheduled_for", grace)
    .limit(50);

  for (const row of stale ?? []) {
    await supabaseAdmin
      .from("outreach_schedule")
      .update({ status: "missed" })
      .eq("id", row.id);
    missed += 1;

    const { count } = await supabaseAdmin
      .from("outreach_schedule")
      .select("*", { count: "exact", head: true })
      .eq("case_id", row.case_id)
      .eq("status", "missed");

    if ((count ?? 0) >= 3) {
      const { data: caseRow } = await supabaseAdmin
        .from("cases")
        .select("assigned_counsellor_id, case_number")
        .eq("id", row.case_id)
        .single();
      if (caseRow?.assigned_counsellor_id) {
        // Create a synthetic distress score id is required — skip if FK blocks; use timeline instead
        await supabaseAdmin.from("case_timeline_events").insert({
          case_id: row.case_id,
          event_type: "disengagement_alert",
          description: "Gone Quiet — 3+ consecutive missed contacts",
          created_by: caseRow.assigned_counsellor_id,
        });
      }
    }
  }

  return { sent, missed };
}

export async function getGoneQuietCaseIds(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("outreach_schedule")
    .select("case_id")
    .eq("status", "missed");

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    counts.set(r.case_id, (counts.get(r.case_id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
}
