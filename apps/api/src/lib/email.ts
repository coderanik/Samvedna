/**
 * Production email sender with Resend when configured.
 * Always writes email_outbox when the table exists (audit).
 * Without RESEND_API_KEY, marks rows as `logged` for demo (never silently drops).
 */
import { supabaseAdmin } from "./supabase";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  template?: string;
  caseId?: string;
  alertId?: string;
};

export type SendEmailResult = {
  ok: boolean;
  status: "sent" | "logged" | "failed" | "skipped";
  id?: string;
  error?: string;
};

function appBaseUrl() {
  return (
    process.env.PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function caseUrl(caseId: string) {
  return `${appBaseUrl()}/counselor/cases/${caseId}`;
}

export function onboardUrl(token: string) {
  return `${appBaseUrl()}/onboard/${token}`;
}

/** Prefer native deep link when EXPO_PUBLIC / PUBLIC_MOBILE_SCHEME set. */
export function onboardDeepLink(token: string) {
  const scheme = (process.env.MOBILE_APP_SCHEME ?? "samvedna").replace(/:\/\/*$/, "");
  return `${scheme}://onboard/${token}`;
}

export function onboardInviteLinks(token: string) {
  return {
    web: onboardUrl(token),
    app: onboardDeepLink(token),
  };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = input.to.trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return { ok: false, status: "skipped", error: "invalid_recipient" };
  }

  let outboxId: string | undefined;
  {
    const { data, error } = await supabaseAdmin
      .from("email_outbox")
      .insert({
        to_email: to,
        subject: input.subject,
        body_text: input.text,
        template: input.template ?? null,
        case_id: input.caseId ?? null,
        alert_id: input.alertId ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (!error && data) outboxId = data.id;
    else if (error) {
      console.warn("[email] outbox insert skipped:", error.message);
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.EMAIL_FROM ?? "Samvedna Alerts <alerts@samvedna.local>";

  if (!apiKey) {
    console.info(
      `[email:demo] → ${to}\n  subject: ${input.subject}\n  ${input.text.slice(0, 240)}…`
    );
    if (outboxId) {
      await supabaseAdmin
        .from("email_outbox")
        .update({ status: "logged", sent_at: new Date().toISOString() })
        .eq("id", outboxId);
    }
    return { ok: true, status: "logged", id: outboxId };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(input.text)}</pre>`,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      const err = body.message ?? `HTTP ${res.status}`;
      if (outboxId) {
        await supabaseAdmin
          .from("email_outbox")
          .update({ status: "failed", error: err })
          .eq("id", outboxId);
      }
      return { ok: false, status: "failed", id: outboxId, error: err };
    }
    if (outboxId) {
      await supabaseAdmin
        .from("email_outbox")
        .update({
          status: "sent",
          provider_id: body.id ?? null,
          sent_at: new Date().toISOString(),
        })
        .eq("id", outboxId);
    }
    return { ok: true, status: "sent", id: outboxId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send_failed";
    if (outboxId) {
      await supabaseAdmin
        .from("email_outbox")
        .update({ status: "failed", error: message })
        .eq("id", outboxId);
    }
    return { ok: false, status: "failed", id: outboxId, error: message };
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
