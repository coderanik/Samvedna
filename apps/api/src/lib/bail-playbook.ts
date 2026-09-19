/**
 * Accused-bail event → witness intimidation / protection playbook.
 * LIVE for demo with honesty note — not a live NHAA/court connector.
 */
import type { Server as SocketServer } from "socket.io";
import { supabaseAdmin } from "./supabase";
import { scheduleEventOutreach } from "./cadence-engine";
import { resolvePlaybook } from "./playbooks";
import { persistRecommendations, type InterventionMatch } from "./intervention-engine";
import { sendEmail, caseUrl } from "./email";
import { notifyRiskThreshold } from "./notify-risk";
import type { SupportType } from "@samvedna/shared-types";

const BAIL_CATALOG_CODES = [
  "POA_WITNESS_PROTECT",
  "POA_RELOCATION",
  "POA_LEGAL_AID",
] as const;

export type BailPlaybookResult = {
  case_id: string;
  case_number: string;
  accused_bail_status: "granted";
  bail_granted_date: string;
  playbook_id: string;
  outreach_scheduled: number;
  recommendations: Array<{ catalog_code: string; due_at: string | null; persisted: boolean }>;
  emails_queued: number;
  honesty: string;
};

async function loadCatalogMatches(caseType: string): Promise<InterventionMatch[]> {
  const { data: rows } = await supabaseAdmin
    .from("intervention_catalog")
    .select("*")
    .in("code", [...BAIL_CATALOG_CODES])
    .eq("active", true);

  const matches: InterventionMatch[] = [];
  for (const row of rows ?? []) {
    const applies = row.applies_to_case_types as string[] | null;
    const typeOk =
      !applies?.length ||
      applies.some(
        (t) =>
          t === caseType ||
          caseType.includes(t) ||
          t === "witness_intimidation"
      );
    if (!typeOk && caseType && !["witness_intimidation", "threat", "intimidation"].some((k) => caseType.includes(k))) {
      // Still allow witness protect on any bail event — proximity risk is universal
      if (row.code !== "POA_WITNESS_PROTECT" && row.code !== "POA_LEGAL_AID") continue;
    }

    matches.push({
      catalog_code: row.code,
      support_type: row.support_type as SupportType,
      title: row.title,
      statutory_basis: row.statutory_basis,
      responsible_authority: row.responsible_authority,
      sla_hours: row.sla_hours,
      description: row.description,
      eligibility_note: row.eligibility_note,
      match_score: 100,
      rationale: `Triggered by accused bail grant (${new Date().toISOString().slice(0, 10)}). Playbook auto-fire for proximity / intimidation risk.`,
      summary: `${row.title} — ${row.statutory_basis} (${row.responsible_authority}, SLA ${row.sla_hours}h)`,
    });
  }

  // Fallback if catalog missing
  if (!matches.length) {
    matches.push({
      catalog_code: "POA_WITNESS_PROTECT",
      support_type: "witness_protection",
      title: "Witness protection measures",
      statutory_basis: "Witness Protection Scheme 2018; PoA Act s.15A",
      responsible_authority: "District Witness Protection Committee",
      sla_hours: 24,
      description: "Threat analysis and protection after accused bail.",
      eligibility_note: null,
      match_score: 90,
      rationale: "Bail event auto-playbook (catalog unavailable — using statutory defaults).",
      summary: "Witness protection — Witness Protection Scheme 2018 (SLA 24h)",
    });
  }

  return matches;
}

/**
 * Grant bail (or re-run playbook) and fire witness-intimidation pathway.
 */
export async function runBailEventPlaybook(opts: {
  caseId: string;
  actorId?: string | null;
  io?: SocketServer;
  source?: "admin_simulate" | "case_patch" | "system";
}): Promise<BailPlaybookResult | { error: string }> {
  const today = new Date().toISOString().split("T")[0];

  const { data: before } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, case_type, status, playbook_id, district, state, assigned_counsellor_id, assigned_official_id, district_notify_email, official_notify_email, next_hearing_date, relief_due_date, relief_amount_sanctioned, relief_amount_disbursed, accused_bail_status, victim_id"
    )
    .eq("id", opts.caseId)
    .maybeSingle();

  if (!before) return { error: "Case not found" };

  const playbook = resolvePlaybook(
    before.case_type === "witness_intimidation" ||
      (before.case_type ?? "").includes("intimidation")
      ? "witness_intimidation"
      : before.case_type
  );

  // Prefer witness_intimidation playbook interventions on bail for threat-adjacent types
  const forceWitness =
    playbook.id === "witness_intimidation" ||
    ["rape", "gang_rape", "murder", "grievous_hurt", "caste_based_violence"].some((t) =>
      (before.case_type ?? "").includes(t)
    );

  const effectivePlaybook = forceWitness
    ? resolvePlaybook("witness_intimidation")
    : playbook;

  const { data: caseRow, error: updateError } = await supabaseAdmin
    .from("cases")
    .update({
      accused_bail_status: "granted",
      bail_granted_date: today,
      playbook_id: effectivePlaybook.id,
      witness_protection_status: "recommended",
    })
    .eq("id", opts.caseId)
    .select(
      "id, case_number, case_type, status, next_hearing_date, relief_due_date, relief_amount_sanctioned, relief_amount_disbursed, assigned_counsellor_id, district_notify_email, official_notify_email, district, state"
    )
    .single();

  let resolvedCase = caseRow;
  if (updateError || !caseRow) {
    // Older schemas may lack playbook_id / witness_protection_status
    const { data: fallback, error: fbErr } = await supabaseAdmin
      .from("cases")
      .update({
        accused_bail_status: "granted",
        bail_granted_date: today,
      })
      .eq("id", opts.caseId)
      .select(
        "id, case_number, case_type, status, next_hearing_date, relief_due_date, relief_amount_sanctioned, relief_amount_disbursed, assigned_counsellor_id, district_notify_email, official_notify_email, district, state"
      )
      .single();
    if (fbErr || !fallback) {
      return { error: updateError?.message ?? fbErr?.message ?? "Failed to update bail status" };
    }
    resolvedCase = fallback;
  }

  if (!resolvedCase) {
    return { error: "Failed to update bail status" };
  }

  const outreachScheduled = await scheduleEventOutreach(resolvedCase, opts.io);

  await supabaseAdmin.from("case_timeline_events").insert({
    case_id: opts.caseId,
    event_type: "bail_granted",
    description: `Accused released on bail as of ${today}. Auto-playbook: ${effectivePlaybook.label}. Source: ${opts.source ?? "system"}.`,
    created_by: opts.actorId ?? resolvedCase.assigned_counsellor_id ?? null,
  });

  const matches = await loadCatalogMatches(before.case_type ?? "witness_intimidation");
  const persisted = await persistRecommendations(opts.caseId, matches, null);

  let emailsQueued = 0;
  const link = caseUrl(opts.caseId);
  const text = [
    `Samvedna bail-event playbook — ${resolvedCase.case_number}`,
    `District: ${resolvedCase.district}, ${resolvedCase.state}`,
    `Playbook: ${effectivePlaybook.label}`,
    `Witness protection / relocation / legal aid recommendations opened with statutory SLAs.`,
    `Open case: ${link}`,
    "",
    "Honesty: Simulated judiciary bail signal for demo — not a live court feed.",
  ].join("\n");

  const recipients = new Set<string>();
  if (resolvedCase.district_notify_email) recipients.add(resolvedCase.district_notify_email);
  if (resolvedCase.official_notify_email) recipients.add(resolvedCase.official_notify_email);
  if (process.env.DISTRICT_ALERT_EMAIL) recipients.add(process.env.DISTRICT_ALERT_EMAIL);

  if (resolvedCase.assigned_counsellor_id) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(
      resolvedCase.assigned_counsellor_id
    );
    if (authUser.user?.email) recipients.add(authUser.user.email);
  }

  for (const to of recipients) {
    const r = await sendEmail({
      to,
      subject: `[Samvedna] Bail granted — protection playbook ${resolvedCase.case_number}`,
      text,
      template: "bail_playbook",
      caseId: opts.caseId,
    });
    if (r.ok) emailsQueued++;
  }

  // Raise a high-severity alert fan-out for counsellor sockets
  try {
    const { data: victim } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", before.victim_id)
      .maybeSingle();

    await notifyRiskThreshold({
      caseId: opts.caseId,
      caseNumber: resolvedCase.case_number,
      caseType: before.case_type,
      victimName: victim?.full_name ?? "Survivor",
      severity: "high",
      reasoning: `Accused bail granted ${today}. ${effectivePlaybook.label} auto-applied.`,
      recommendedAction: "Confirm witness protection application and same-day safety check.",
      escalationRisk7d: 75,
      trendDirection: "rising",
      io: opts.io,
    });
  } catch (err) {
    console.warn("[bail-playbook] notify", err instanceof Error ? err.message : err);
  }

  return {
    case_id: opts.caseId,
    case_number: resolvedCase.case_number,
    accused_bail_status: "granted",
    bail_granted_date: today,
    playbook_id: effectivePlaybook.id,
    outreach_scheduled: outreachScheduled.length,
    recommendations: persisted.map((p) => ({
      catalog_code: p.catalog_code,
      due_at: p.due_at,
      persisted: p.persisted,
    })),
    emails_queued: emailsQueued,
    honesty:
      "Demo / simulated bail connector. Auto-fires Witness Protection Scheme pathway with SLA clocks — not a live NHAA or court API.",
  };
}
