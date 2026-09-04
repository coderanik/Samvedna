import twilio from "twilio";
import { toE164Indian } from "./phone";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /** Public HTTPS base for voice webhooks (ngrok / deployed API). */
  webhookBaseUrl: string;
  /** Optional Twilio-hosted TwiML / Conversational template URL. */
  twimlUrl: string | null;
  /** TTS voice — Polly.Aditi works well for Indian English / Hindi. */
  voice: string;
  /** Skip X-Twilio-Signature checks (local only). */
  skipSignatureValidation: boolean;
  /** Max conversational turns before we politely end. */
  maxTurns: number;
}

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) return null;

  const webhookBaseUrl = (
    process.env.TWILIO_WEBHOOK_BASE_URL ??
    process.env.PUBLIC_API_URL ??
    process.env.EXOTEL_WEBHOOK_BASE_URL ??
    ""
  ).replace(/\/$/, "");

  return {
    accountSid,
    authToken,
    fromNumber,
    webhookBaseUrl,
    twimlUrl: process.env.TWILIO_TWIML_URL?.trim() || null,
    voice: process.env.TWILIO_VOICE ?? "Polly.Aditi",
    skipSignatureValidation: process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === "true",
    maxTurns: Math.min(20, Math.max(3, parseInt(process.env.TWILIO_MAX_TURNS ?? "8", 10) || 8)),
  };
}

export function isTwilioConfigured(): boolean {
  return getTwilioConfig() !== null;
}

/** True when we can place LIVE outbound calls (creds + HTTPS webhook or TwiML template). */
export function isTwilioLive(): boolean {
  const cfg = getTwilioConfig();
  if (!cfg) return false;
  return Boolean(cfg.webhookBaseUrl.startsWith("https://") || cfg.twimlUrl?.startsWith("https://"));
}

export function twilioClient() {
  const cfg = getTwilioConfig();
  if (!cfg) throw new Error("Twilio is not configured");
  return twilio(cfg.accountSid, cfg.authToken);
}

export function webhookUrl(path: string): string {
  const cfg = getTwilioConfig();
  if (!cfg?.webhookBaseUrl) {
    throw new Error(
      "TWILIO_WEBHOOK_BASE_URL (or PUBLIC_API_URL) must be a public HTTPS URL for Twilio voice"
    );
  }
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${cfg.webhookBaseUrl}${p}`;
}

export function gatherLanguage(preferredLanguage: string): string {
  const map: Record<string, string> = {
    en: "en-IN",
    hi: "hi-IN",
    ta: "ta-IN",
    te: "te-IN",
    mr: "mr-IN",
    bn: "bn-IN",
    kn: "kn-IN",
    gu: "gu-IN",
    ml: "ml-IN",
    pa: "pa-IN",
  };
  return map[preferredLanguage] ?? "en-IN";
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greeting in the survivor's preferred language. */
export function greetingForLocale(locale: string): string {
  if (locale === "hi") {
    return "नमस्ते। मैं मन-मित्र हूँ, समवेदना से। मैं यहाँ सुनने के लिए हूँ। आज आप कैसा महसूस कर रहे हैं? बोलने के बाद थोड़ा रुक जाएँ।";
  }
  if (locale === "ta") {
    return "வணக்கம். நான் மன்-மித்ரா, சம்வேத்னாவிலிருந்து. இன்று நீங்கள் எப்படி உணர்கிறீர்கள்? பேசிய பிறகு சிறிது இடைவெளி விடுங்கள்.";
  }
  return "Namaste. I am Mann-Mitra from Samvedna. I am here to listen. How are you feeling today? Please speak after a short pause, then wait for me.";
}

export function closingForLocale(locale: string): string {
  if (locale === "hi") {
    return "धन्यवाद। आपकी बात सुरक्षित रख ली गई है। ज़रूरत हो तो NHAA 14566, Tele-MANAS 14416, या 112 पर कॉल करें। अपना ख्याल रखें।";
  }
  if (locale === "ta") {
    return "நன்றி. நீங்கள் பகிர்ந்தது பாதுகாக்கப்பட்டுள்ளது. தேவைப்பட்டால் NHAA 14566, Tele-MANAS 14416, அல்லது 112 அழைக்கவும். கவனமாக இருங்கள்.";
  }
  return "Thank you. What you shared has been kept safely. If you need someone now: NHAA 14566, Tele-MANAS 14416, KIRAN 1800-599-0019, or emergency 112. Take care.";
}

/**
 * Build conversational TwiML: speak prompt, then Gather speech → /gather webhook.
 */
export function conversationalTwiml(opts: {
  sayText: string;
  actionPath: string;
  language: string;
  voice?: string;
  hint?: string;
  /** Absolute or path redirect if gather times out with no speech after the nudge. */
  retryActionPath?: string;
}): string {
  const cfg = getTwilioConfig();
  const voice = opts.voice ?? cfg?.voice ?? "Polly.Aditi";

  const resolve = (path: string) => {
    if (path.startsWith("http")) return path;
    try {
      return webhookUrl(path.startsWith("/") ? path : `/${path}`);
    } catch {
      return path;
    }
  };

  const action = resolve(opts.actionPath);
  const retry = opts.retryActionPath ? resolve(opts.retryActionPath) : action;
  const hintAttr = opts.hint ? ` hints="${escapeXml(opts.hint)}"` : "";
  const silenceNudge = opts.language.startsWith("hi")
    ? "मैंने कुछ नहीं सुना। यदि आप अभी बात नहीं करना चाहते, कॉल काट सकते हैं। अन्यथा कुछ कहें।"
    : "I did not catch that. You can hang up anytime, or say something when you are ready.";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" language="${escapeXml(opts.language)}" speechTimeout="auto" timeout="7" action="${escapeXml(action)}" method="POST"${hintAttr}>
    <Say voice="${escapeXml(voice)}">${escapeXml(opts.sayText)}</Say>
  </Gather>
  <Say voice="${escapeXml(voice)}">${escapeXml(silenceNudge)}</Say>
  <Redirect method="POST">${escapeXml(retry)}</Redirect>
</Response>`;
}

/** End-of-call TwiML (no further gather). */
export function hangupTwiml(sayText: string, voice?: string): string {
  const cfg = getTwilioConfig();
  const v = voice ?? cfg?.voice ?? "Polly.Aditi";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXml(v)}">${escapeXml(sayText)}</Say>
  <Hangup/>
</Response>`;
}

export interface TwilioOutboundResult {
  callSid: string;
  status: string;
  mode: "twilio_outbound";
  to: string;
}

/**
 * Place an outbound Conversational AI voice call.
 * Prefers Samvedna /webhooks/twilio/voice (Mann-Mitra). Falls back to TWILIO_TWIML_URL.
 */
export async function placeTwilioOutboundCall(opts: {
  toPhone: string;
  /** Passed as Twilio StatusCallback / custom query on voice URL */
  instantCallId: string;
  statusCallbackUrl?: string;
}): Promise<TwilioOutboundResult> {
  const cfg = getTwilioConfig();
  if (!cfg) throw new Error("Twilio is not configured");

  const to = toE164Indian(opts.toPhone);
  if (!to) throw new Error("Invalid phone number for Twilio (expected Indian mobile)");

  const hasWebhook = cfg.webhookBaseUrl.startsWith("https://");
  const hasTemplate = Boolean(cfg.twimlUrl?.startsWith("https://"));
  if (!hasWebhook && !hasTemplate) {
    throw new Error(
      "Twilio needs TWILIO_WEBHOOK_BASE_URL (public HTTPS, e.g. ngrok) or TWILIO_TWIML_URL"
    );
  }

  const client = twilioClient();

  // Prefer Samvedna Mann-Mitra webhooks; fall back to Twilio-hosted template
  const voiceUrl = hasWebhook
    ? `${webhookUrl("/webhooks/twilio/voice")}?instant_call_id=${encodeURIComponent(opts.instantCallId)}`
    : cfg.twimlUrl!;

  // Trial accounts reject many optional params — keep the payload minimal (matches Twilio curl)
  const createOpts: {
    to: string;
    from: string;
    url: string;
    statusCallback?: string;
    statusCallbackMethod?: "POST";
  } = {
    to,
    from: cfg.fromNumber,
    url: voiceUrl,
  };

  // Status callbacks only when not on a restricted trial path
  if (hasWebhook && process.env.TWILIO_STATUS_CALLBACKS !== "false") {
    createOpts.statusCallback =
      opts.statusCallbackUrl ??
      `${webhookUrl("/webhooks/twilio/status")}?instant_call_id=${encodeURIComponent(opts.instantCallId)}`;
    createOpts.statusCallbackMethod = "POST";
  }

  let call;
  try {
    call = await client.calls.create(createOpts);
  } catch (err) {
    // Retry with absolute minimum if trial rejects status callbacks
    const msg = err instanceof Error ? err.message : String(err);
    if (/disallowed parameters|trial/i.test(msg) && createOpts.statusCallback) {
      console.warn("[Twilio] retrying without statusCallback (trial limitation)");
      call = await client.calls.create({
        to: createOpts.to,
        from: createOpts.from,
        url: createOpts.url,
      });
    } else {
      throw err;
    }
  }

  return {
    callSid: call.sid,
    status: call.status,
    mode: "twilio_outbound",
    to,
  };
}

/** Validate Twilio request signature. Returns true if valid or validation skipped. */
export function validateTwilioSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, string>
): boolean {
  const cfg = getTwilioConfig();
  if (!cfg) return false;
  if (cfg.skipSignatureValidation) return true;
  if (!signature) return false;
  return twilio.validateRequest(cfg.authToken, signature, url, params);
}

/** Reconstruct the public URL Twilio signed (must match webhook base, not localhost). */
export function signedWebhookUrl(reqPathWithQuery: string): string {
  const cfg = getTwilioConfig();
  const base = cfg?.webhookBaseUrl ?? "";
  const path = reqPathWithQuery.startsWith("/") ? reqPathWithQuery : `/${reqPathWithQuery}`;
  return `${base}${path}`;
}
