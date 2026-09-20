import { supabaseAdmin } from "./supabase";
import { sendEmail, caseUrl } from "./email";
import { resolvePlaybook } from "./playbooks";
import type { RiskLevel } from "@samvedna/shared-types";

/**
 * Create a daily 60-minute counselling series for high/critical cases.
 * Idempotent while an active series exists.
 */
export async function maybeScheduleDailyCounselling(opts: {
  caseId: string;
  victimId: string;
  risk: RiskLevel;
  caseType?: string | null;
  days?: number;
  hourIst?: number;
}): Promise<{ scheduled: boolean; seriesId?: string; sessions?: number; reason: string }> {
  const playbook = resolvePlaybook(opts.caseType);
  const should =
    opts.risk === "critical" ||
    opts.risk === "high" ||
    playbook.auto_daily_counselling;

  if (!(opts.risk === "critical" || opts.risk === "high")) {
    return { scheduled: false, reason: "risk_below_threshold" };
  }
  if (!should && opts.risk !== "critical" && opts.risk !== "high") {
    return { scheduled: false, reason: "playbook_skips_auto_series" };
  }

  const { data: existing } = await supabaseAdmin
    .from("counselling_series")
    .select("id")
    .eq("case_id", opts.caseId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return { scheduled: false, seriesId: existing.id, reason: "series_already_active" };
  }

  const { data: caseRow } = await supabaseAdmin
    .from("cases")
    .select("assigned_counsellor_id, case_number")
    .eq("id", opts.caseId)
    .maybeSingle();

  const days = opts.days ?? 7;
  const hour = opts.hourIst ?? 11;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const { data: series, error: seriesErr } = await supabaseAdmin
    .from("counselling_series")
    .insert({
      case_id: opts.caseId,
      victim_id: opts.victimId,
      counsellor_id: caseRow?.assigned_counsellor_id ?? null,
      duration_minutes: 60,
      days,
      starts_on: tomorrow.toISOString().slice(0, 10),
      status: "active",
    })
    .select("id")
    .single();

  if (seriesErr || !series) {
    console.warn("[counselling-series]", seriesErr?.message);
    return { scheduled: false, reason: seriesErr?.message ?? "series_insert_failed" };
  }

  const sessions = [];
  for (let i = 0; i < days; i++) {
    const local = new Date(tomorrow);
    local.setDate(tomorrow.getDate() + i);
    local.setHours(hour, 0, 0, 0);
    const room = `https://meet.jit.si/samvedna-${opts.caseId.replace(/-/g, "").slice(0, 10)}-d${i + 1}`;
    sessions.push({
      series_id: series.id,
      case_id: opts.caseId,
      victim_id: opts.victimId,
      counsellor_id: caseRow?.assigned_counsellor_id ?? null,
      scheduled_at: local.toISOString(),
      duration_minutes: 60,
      status: "scheduled",
      video_room_url: room,
    });
  }

  const { error: sessErr } = await supabaseAdmin.from("counselling_sessions").insert(sessions);
  if (sessErr) {
    console.warn("[counselling-sessions]", sessErr.message);
    return { scheduled: false, seriesId: series.id, reason: sessErr.message };
  }

  if (caseRow?.assigned_counsellor_id) {
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(
        caseRow.assigned_counsellor_id
      );
      if (authUser.user?.email) {
        await sendEmail({
          to: authUser.user.email,
          subject: `[Samvedna] Daily counselling series started — ${caseRow.case_number ?? opts.caseId}`,
          text: [
            `A ${days}-day × 60-minute counselling series was scheduled for case ${caseRow.case_number}.`,
            `First session: ${new Date(sessions[0].scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
            `Open case: ${caseUrl(opts.caseId)}`,
          ].join("\n"),
          template: "counselling_series",
          caseId: opts.caseId,
        });
      }
    } catch (err) {
      console.warn("[counselling-series] notify", err);
    }
  }

  await supabaseAdmin.from("case_timeline_events").insert({
    case_id: opts.caseId,
    event_type: "counselling_series_scheduled",
    description: `Daily 60-minute counselling scheduled for ${days} days (${playbook.id}).`,
    created_by: opts.victimId,
  });

  return {
    scheduled: true,
    seriesId: series.id,
    sessions: sessions.length,
    reason: "scheduled",
  };
}
