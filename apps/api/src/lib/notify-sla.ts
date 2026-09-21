/**
 * Email counsellor + district when a statutory recommendation SLA is breached.
 */
import { supabaseAdmin } from "./supabase";
import { caseUrl, sendEmail } from "./email";

type BreachRow = {
  id: string;
  case_id: string;
  type: string;
  description: string;
  catalog_code: string | null;
  statutory_basis: string | null;
  responsible_authority: string | null;
  sla_hours: number | null;
  due_at: string | null;
};

export async function notifySlaBreaches(rows: BreachRow[]): Promise<number> {
  if (!rows.length) return 0;

  const caseIds = [...new Set(rows.map((r) => r.case_id))];
  const { data: cases } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, district, state, assigned_counsellor_id, district_notify_email, official_notify_email"
    )
    .in("id", caseIds);

  const caseMap = new Map((cases ?? []).map((c) => [c.id, c] as const));
  let sent = 0;

  for (const row of rows) {
    const c = caseMap.get(row.case_id);
    if (!c) continue;

    const hoursOverdue = row.due_at
      ? Math.max(0, Math.round((Date.now() - new Date(row.due_at).getTime()) / 36e5))
      : null;

    const text = [
      `SLA BREACH — Samvedna intervention overdue`,
      `Case: ${c.case_number} (${c.district}, ${c.state})`,
      `Intervention: ${row.catalog_code ?? row.type}`,
      row.statutory_basis ? `Basis: ${row.statutory_basis}` : null,
      row.responsible_authority ? `Authority: ${row.responsible_authority}` : null,
      row.sla_hours != null ? `SLA: ${row.sla_hours}h` : null,
      hoursOverdue != null ? `Overdue by ~${hoursOverdue}h` : null,
      "",
      row.description.slice(0, 400),
      "",
      `Open case: ${caseUrl(row.case_id)}`,
      "",
      "Action required: update status or escalate to district magistrate / SP as applicable.",
    ]
      .filter(Boolean)
      .join("\n");

    const recipients = new Set<string>();
    if (c.district_notify_email) recipients.add(c.district_notify_email);
    if (c.official_notify_email) recipients.add(c.official_notify_email);
    if (process.env.DISTRICT_ALERT_EMAIL) recipients.add(process.env.DISTRICT_ALERT_EMAIL);
    if (process.env.OFFICIAL_ALERT_EMAIL) recipients.add(process.env.OFFICIAL_ALERT_EMAIL);

    if (c.assigned_counsellor_id) {
      try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(
          c.assigned_counsellor_id
        );
        if (authUser.user?.email) recipients.add(authUser.user.email);
      } catch {
        /* ignore */
      }
    }

    for (const to of recipients) {
      const r = await sendEmail({
        to,
        subject: `[Samvedna] SLA breach — ${c.case_number} / ${row.catalog_code ?? row.type}`,
        text,
        template: "sla_breach",
        caseId: row.case_id,
      });
      if (r.ok) sent++;
    }
  }

  return sent;
}
