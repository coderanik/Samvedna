import { toE164Indian, toExotelFrom } from "./phone";

export interface ExotelConfig {
  apiKey: string;
  apiToken: string;
  sid: string;
  callerId: string;
  subdomain: string;
  webhookBaseUrl: string;
  smsSenderId?: string;
  dltEntityId?: string;
  dltTemplateId?: string;
  ivrsAppId?: string;
}

export function getExotelConfig(): ExotelConfig | null {
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  const sid = process.env.EXOTEL_SID;
  const callerId = process.env.EXOTEL_CALLER_ID;

  if (!apiKey || !apiToken || !sid || !callerId) return null;

  return {
    apiKey,
    apiToken,
    sid,
    callerId,
    subdomain: process.env.EXOTEL_SUBDOMAIN ?? "api.exotel.com",
    webhookBaseUrl: (process.env.EXOTEL_WEBHOOK_BASE_URL ?? process.env.PUBLIC_API_URL ?? "").replace(/\/$/, ""),
    smsSenderId: process.env.EXOTEL_SMS_SENDER_ID,
    dltEntityId: process.env.EXOTEL_DLT_ENTITY_ID,
    dltTemplateId: process.env.EXOTEL_DLT_TEMPLATE_ID,
    ivrsAppId: process.env.EXOTEL_IVRS_APP_ID,
  };
}

export function isExotelConfigured(): boolean {
  return getExotelConfig() !== null;
}

function apiBase(cfg: ExotelConfig): string {
  return `https://${cfg.apiKey}:${cfg.apiToken}@${cfg.subdomain}/v1/Accounts/${cfg.sid}`;
}

async function exotelPost(cfg: ExotelConfig, path: string, params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${apiBase(cfg)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "RestException" in data
        ? String((data as { RestException?: { Message?: string } }).RestException?.Message)
        : text.slice(0, 300);
    throw new Error(`Exotel API error (${res.status}): ${msg}`);
  }

  return data as Record<string, unknown>;
}

export interface ConnectTwoNumbersOpts {
  /** Called first (e.g. counsellor). */
  from: string;
  /** Connected after From answers (e.g. victim). */
  to: string;
  customField?: string;
  record?: boolean;
  statusCallbackUrl?: string;
}

/** Bridge two phone numbers — counsellor is dialed first, then victim. */
export async function connectTwoNumbers(opts: ConnectTwoNumbersOpts): Promise<{ callSid: string }> {
  const cfg = getExotelConfig();
  if (!cfg) throw new Error("Exotel is not configured");

  const from = toExotelFrom(opts.from) ?? toE164Indian(opts.from);
  const to = toE164Indian(opts.to);
  if (!from || !to) throw new Error("Invalid phone numbers for Exotel bridge");

  const params: Record<string, string> = {
    From: from,
    To: to,
    CallerId: cfg.callerId.replace(/\D/g, "").length === 10 ? `0${cfg.callerId.replace(/\D/g, "")}` : cfg.callerId,
    CallType: "trans",
    Record: opts.record === false ? "false" : "true",
    RecordingChannels: "dual",
    StatusCallbackEvents: "terminal",
    StatusCallbackContentType: "application/json",
  };

  if (opts.customField) params.CustomField = opts.customField.slice(0, 128);
  if (opts.statusCallbackUrl) params.StatusCallback = opts.statusCallbackUrl;
  else if (cfg.webhookBaseUrl) {
    params.StatusCallback = `${cfg.webhookBaseUrl}/webhooks/exotel/voice/status`;
  }

  const data = await exotelPost(cfg, "/Calls/connect", params);
  const call = data.Call as { Sid?: string } | undefined;
  if (!call?.Sid) throw new Error("Exotel did not return Call Sid");
  return { callSid: call.Sid };
}

export interface ConnectToFlowOpts {
  from: string;
  flowUrl: string;
  customField?: string;
  statusCallbackUrl?: string;
}

/** Outbound call that connects caller to an Exotel App Bazaar flow. */
export async function connectToFlow(opts: ConnectToFlowOpts): Promise<{ callSid: string }> {
  const cfg = getExotelConfig();
  if (!cfg) throw new Error("Exotel is not configured");

  const from = toExotelFrom(opts.from) ?? toE164Indian(opts.from);
  if (!from) throw new Error("Invalid From phone for Exotel");

  const params: Record<string, string> = {
    From: from,
    CallerId: cfg.callerId.replace(/\D/g, "").length === 10 ? `0${cfg.callerId.replace(/\D/g, "")}` : cfg.callerId,
    Url: opts.flowUrl,
    CallType: "trans",
    StatusCallbackEvents: "terminal",
    StatusCallbackContentType: "application/json",
  };

  if (opts.customField) params.CustomField = opts.customField.slice(0, 128);
  if (opts.statusCallbackUrl) params.StatusCallback = opts.statusCallbackUrl;
  else if (cfg.webhookBaseUrl) {
    params.StatusCallback = `${cfg.webhookBaseUrl}/webhooks/exotel/voice/status`;
  }

  const data = await exotelPost(cfg, "/Calls/connect", params);
  const call = data.Call as { Sid?: string } | undefined;
  if (!call?.Sid) throw new Error("Exotel did not return Call Sid");
  return { callSid: call.Sid };
}

export async function sendSms(to: string, body: string, customField?: string): Promise<{ smsSid: string }> {
  const cfg = getExotelConfig();
  if (!cfg) throw new Error("Exotel is not configured");

  const recipient = toE164Indian(to);
  if (!recipient) throw new Error("Invalid SMS recipient");

  const params: Record<string, string> = {
    From: cfg.smsSenderId ?? cfg.callerId,
    To: recipient,
    Body: body.slice(0, 2000),
    SmsType: "transactional_opt_in",
  };

  if (cfg.dltEntityId) params.DltEntityId = cfg.dltEntityId;
  if (cfg.dltTemplateId) params.DltTemplateId = cfg.dltTemplateId;
  if (customField) params.CustomField = customField.slice(0, 128);
  if (cfg.webhookBaseUrl) {
    params.StatusCallback = `${cfg.webhookBaseUrl}/webhooks/exotel/sms/status`;
  }

  const data = await exotelPost(cfg, "/Sms/send", params);
  const sms = data.SMSMessage as { Sid?: string } | undefined;
  if (!sms?.Sid) throw new Error("Exotel did not return SMS Sid");
  return { smsSid: sms.Sid };
}

/** Public ExoML URL for inbound IVRS (configure as URL applet in Exotel). */
export function inboundExomlUrl(): string | null {
  const cfg = getExotelConfig();
  if (!cfg?.webhookBaseUrl) return null;
  return `${cfg.webhookBaseUrl}/webhooks/exotel/exoml/inbound`;
}
