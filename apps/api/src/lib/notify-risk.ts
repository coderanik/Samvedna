import type { Server as SocketServer } from "socket.io";
import { supabaseAdmin } from "./supabase";
import { caseUrl, sendEmail } from "./email";
import { resolvePlaybook } from "./playbooks";
import { pushVictimCareNotice } from "./push";
import type { RiskLevel } from "@samvedna/shared-types";

type NotifyInput = {
  caseId: string;
  caseNumber: string;
  caseType?: string | null;
  victimName: string;
  severity: RiskLevel;
  reasoning: string;
  recommendedAction: string;
  escalationRisk7d?: number;
  trendDirection?: string;
  distressScoreId?: string;
  io?: SocketServer;
  /** Existing DB alert rows already created for counsellor — avoid dup inserts when possible */
  primaryAlertId?: string;
};

type Recipient = {
  profileId?: string | null;
  email: string;
  role: "counsellor" | "district" | "official";
};

async function resolveRecipients(caseId: string): Promise<{
  recipients: Recipient[];
  caseRow: Record<string, unknown> | null;
}> {
  const { data: caseRow } = await supabaseAdmin
    .from("cases")
    .select(
      "id, case_number, case_type, assigned_counsellor_id, assigned_official_id, district_notify_email, official_notify_email, playbook_id"
    )
    .eq("id", caseId)
    .maybeSingle();

  if (!caseRow) return { recipients: [], caseRow: null };

  const recipients: Recipient[] = [];

  if (caseRow.assigned_counsellor_id) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(
      caseRow.assigned_counsellor_id
    );
    const email = authUser.user?.email;
    if (email) {
      recipients.push({
        profileId: caseRow.assigned_counsellor_id,
        email,
        role: "counsellor",
      });
    }
  }

  if (caseRow.assigned_official_id) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(
      caseRow.assigned_official_id
    );
    const email = authUser.user?.email;
    if (email) {
      recipients.push({
        profileId: caseRow.assigned_official_id,
        email,
        role: "official",
      });
    }
  }

  const districtEmail =
    (caseRow.district_notify_email as string | null) ||
    process.env.DISTRICT_ALERT_EMAIL ||
    null;
  if (districtEmail) {
    recipients.push({ email: districtEmail, role: "district" });
  }

  const officialEmail =
    (caseRow.official_notify_email as string | null) ||
    process.env.OFFICIAL_ALERT_EMAIL ||
    null;
  if (officialEmail && officialEmail !== districtEmail) {
    recipients.push({ email: officialEmail, role: "official" });
  }

  return { recipients, caseRow };
}

function shouldEmailRole(
  role: Recipient["role"],
  severity: RiskLevel,
  escalation: number,
  caseType: string | null | undefined
) {
  if (role === "counsellor") return true;
  const playbook = resolvePlaybook(caseType);
  if (severity === "critical" && playbook.alert_district_on.includes("critical")) return true;
  if (severity === "high" && playbook.alert_district_on.includes("high")) return true;
  if (escalation >= 70 && playbook.alert_district_on.includes("escalation")) return true;
  return severity === "critical";
}

/**
 * Fan-out risk notifications: socket to profile rooms + email to counsellor/district/official.
 */
export async function notifyRiskThreshold(input: NotifyInput) {
  const { recipients, caseRow } = await resolveRecipients(input.caseId);
  const escalation = input.escalationRisk7d ?? 0;
  const caseType = (caseRow?.case_type as string | undefined) ?? input.caseType;

  const subject = `[Samvedna] ${input.severity.toUpperCase()} distress — ${input.caseNumber}`;
  const text = [
    `Severity: ${input.severity}`,
    `Case: ${input.caseNumber}`,
    `Survivor: ${input.victimName}`,
    input.escalationRisk7d != null ? `Escalation risk (7d): ${input.escalationRisk7d}` : null,
    input.trendDirection ? `Trend: ${input.trendDirection}` : null,
    "",
    `Assessment: ${input.reasoning}`,
    "",
    `Recommended action: ${input.recommendedAction}`,
    "",
    `Open case: ${caseUrl(input.caseId)}`,
    "",
    "This is decision-support for authorised professionals — not an emergency dispatch.",
    "If life is at risk: 112 · KIRAN 1800-599-0019 · Tele-MANAS 14416.",
  ]
    .filter(Boolean)
    .join("\n");

  const results = [];

  for (const r of recipients) {
    if (!shouldEmailRole(r.role, input.severity, escalation, caseType)) continue;

    // Persist alert row for profile-bound staff (district email-only skips DB alert)
    let alertId = input.primaryAlertId;
    if (r.profileId && r.role !== "district") {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin
        .from("alerts")
        .select("id")
        .eq("case_id", input.caseId)
        .eq("assigned_to", r.profileId)
        .in("status", ["open", "acknowledged"])
        .gte("created_at", since)
        .limit(1);

      if (existing?.[0]) {
        alertId = existing[0].id;
      } else if (r.role !== "counsellor" || !alertId) {
        const { data: alertRow } = await supabaseAdmin
          .from("alerts")
          .insert({
            case_id: input.caseId,
            distress_score_id: input.distressScoreId ?? null,
            severity: input.severity,
            status: "open",
            assigned_to: r.profileId,
          })
          .select("id")
          .single();
        alertId = alertRow?.id;
      }

        if (input.io && r.profileId) {
        const event = {
          alert: {
            id: alertId ?? "pending",
            case_id: input.caseId,
            distress_score_id: input.distressScoreId ?? "",
            severity: input.severity,
            status: "open" as const,
            assigned_to: r.profileId,
            created_at: new Date().toISOString(),
            resolved_at: null,
          },
          case_id: input.caseId,
          case_number: input.caseNumber,
          victim_name: input.victimName,
          severity: input.severity,
          reasoning: input.reasoning,
          escalation_risk_7d: input.escalationRisk7d,
          trend_direction: input.trendDirection,
          recommended_action: input.recommendedAction,
        };
        input.io.to(`user:${r.profileId}`).emit("new_alert", event);
        input.io.to(`case:${input.caseId}`).emit("new_alert", event);
      }
    }

    const mail = await sendEmail({
      to: r.email,
      subject: `${subject} (${r.role})`,
      text,
      template: "risk_threshold",
      caseId: input.caseId,
      alertId,
    });
    results.push({ role: r.role, email: r.email, mail });
  }

  // Soft push to survivor — never includes scores
  try {
    const { data: caseVictim } = await supabaseAdmin
      .from("cases")
      .select("victim_id")
      .eq("id", input.caseId)
      .maybeSingle();
    if (caseVictim?.victim_id && (input.severity === "high" || input.severity === "critical")) {
      await pushVictimCareNotice(caseVictim.victim_id, {
        title: "Someone is looking out for you",
        body: "Your care team was notified. Open Samvedna when you feel ready — no rush.",
        data: { kind: "care_alert", case_id: input.caseId },
      });
    }
  } catch (err) {
    console.warn("[notify-risk] victim push", err instanceof Error ? err.message : err);
  }

  return { recipients: results };
}
