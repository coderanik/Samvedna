import { Router, type Request, type Response, type NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import { summariseCallTranscript } from "../lib/call-summary";
import {
  closingForLocale,
  conversationalTwiml,
  gatherLanguage,
  getTwilioConfig,
  greetingForLocale,
  hangupTwiml,
  isTwilioConfigured,
  isTwilioLive,
  signedWebhookUrl,
  validateTwilioSignature,
  webhookUrl,
} from "../lib/twilio";
import {
  bindTwilioSid,
  clearLiveTwilioCall,
  getLiveTwilioCall,
  getLiveTwilioCallBySid,
  updateLiveTwilioCall,
} from "../lib/twilio-call-state";
import type { Server as SocketServer } from "socket.io";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

/** Per-call turn buffer (CallSid → turns). Survives the call; cleared on finalize. */
const callTurns = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

type InstantRow = {
  id: string;
  user_id: string;
  case_id: string | null;
  call_session_id: string | null;
  twilio_call_sid: string | null;
  transcript: string | null;
  status: string;
  distress_score_id?: string | null;
  duration_seconds?: number | null;
  _memory?: boolean;
};

function twilioBodyParams(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
    else if (v != null) out[k] = String(v);
  }
  return out;
}

function twilioParams(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...req.query, ...req.body })) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}

function sendTwiml(res: Response, xml: string) {
  res.status(200).type("text/xml").send(xml);
}

function requireTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const cfg = getTwilioConfig();
  if (!cfg) return res.status(503).type("text/plain").send("Twilio not configured");

  const signature = req.header("X-Twilio-Signature") ?? undefined;
  const url = signedWebhookUrl(req.originalUrl);
  const body = twilioBodyParams(req);

  if (!validateTwilioSignature(signature, url, body)) {
    console.warn("[Twilio] invalid signature for", url);
    return res.status(403).type("text/plain").send("Invalid signature");
  }
  next();
}

async function loadInstantContext(
  instantCallId: string | undefined,
  callSid: string | undefined
): Promise<InstantRow | null> {
  const live =
    getLiveTwilioCall(instantCallId) ?? getLiveTwilioCallBySid(callSid);
  if (live) {
    if (callSid && !live.twilioCallSid) bindTwilioSid(live.id, callSid);
    return {
      id: live.id,
      user_id: live.userId,
      case_id: live.caseId,
      call_session_id: live.callSessionId,
      twilio_call_sid: callSid ?? live.twilioCallSid ?? null,
      transcript: live.transcript || null,
      status: live.status,
      _memory: true,
    };
  }

  if (instantCallId) {
    const { data } = await supabaseAdmin
      .from("instant_calls")
      .select("*")
      .eq("id", instantCallId)
      .maybeSingle();
    if (data) return data as InstantRow;
  }
  if (callSid) {
    const { data } = await supabaseAdmin
      .from("instant_calls")
      .select("*")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();
    if (data) return data as InstantRow;
  }
  return null;
}

async function localeForUser(userId: string | null | undefined): Promise<string> {
  if (!userId) return "en";
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("preferred_language")
    .eq("id", userId)
    .maybeSingle();
  return data?.preferred_language ?? "en";
}

async function mannMitraReply(
  message: string,
  history: Array<{ role: string; content: string }>,
  preferredLanguage: string
): Promise<string> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 18_000);
    const res = await fetch(`${ML_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        preferred_language: preferredLanguage,
        conversation_history: history.slice(-8),
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const data = (await res.json()) as { response?: string; reply?: string };
      const text = (data.response ?? data.reply ?? "").trim();
      if (text) return text.slice(0, 600);
    }
  } catch (err) {
    console.warn("[Twilio] Mann-Mitra unavailable:", err instanceof Error ? err.message : err);
  }
  if (preferredLanguage === "hi") {
    return "मैं सुन रहा हूँ। थोड़ा और बताएँ — आज की नींद या मन कैसा रहा?";
  }
  return "I am listening. Tell me a little more about how today has felt for you.";
}

function turnsToTranscript(turns: Array<{ role: string; content: string }>): string {
  return turns
    .map((t) => `${t.role === "user" ? "Survivor" : "Mann-Mitra"}: ${t.content}`)
    .join("\n");
}

export async function finalizeTwilioInstantCall(
  instantCallId: string,
  io?: SocketServer,
  extras?: { callStatus?: string; durationSeconds?: number }
): Promise<void> {
  const live = getLiveTwilioCall(instantCallId);
  const { data: dbInstant } = await supabaseAdmin
    .from("instant_calls")
    .select("*")
    .eq("id", instantCallId)
    .maybeSingle();

  const instant: InstantRow | null = live
    ? {
        id: live.id,
        user_id: live.userId,
        case_id: live.caseId,
        call_session_id: live.callSessionId,
        twilio_call_sid: live.twilioCallSid ?? null,
        transcript: live.transcript || null,
        status: live.status,
        _memory: true,
      }
    : (dbInstant as InstantRow | null);

  if (!instant) return;
  if (instant.status === "completed") return;

  const callSid = instant.twilio_call_sid as string | null;
  const buffered = callSid ? callTurns.get(callSid) ?? [] : [];
  const transcript = (
    buffered.length ? turnsToTranscript(buffered) : instant.transcript ?? ""
  ).trim();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("preferred_language")
    .eq("id", instant.user_id)
    .single();

  const summary = await summariseCallTranscript(
    transcript,
    profile?.preferred_language ?? "en"
  );

  let distressScoreId: string | null = instant.distress_score_id ?? null;

  if (transcript && instant.case_id && !distressScoreId) {
    try {
      const scored = await createCheckinAndScore({
        caseId: instant.case_id,
        victimId: instant.user_id,
        transcript,
        channel: "ai_voice",
        io,
      });
      distressScoreId = scored.distressScore?.id ?? null;
    } catch (err) {
      console.warn("[Twilio] scoring failed:", err instanceof Error ? err.message : err);
    }
  }

  const finalStatus =
    extras?.callStatus === "busy" ||
    extras?.callStatus === "no-answer" ||
    extras?.callStatus === "failed" ||
    extras?.callStatus === "canceled"
      ? extras.callStatus
      : "completed";

  if (!instant._memory) {
    await supabaseAdmin
      .from("instant_calls")
      .update({
        transcript: transcript || instant.transcript,
        summary,
        duration_seconds: extras?.durationSeconds ?? instant.duration_seconds,
        status: finalStatus,
        distress_score_id: distressScoreId,
      })
      .eq("id", instant.id);
  } else {
    updateLiveTwilioCall(instant.id, {
      transcript,
      status: finalStatus,
    });
  }

  if (instant.call_session_id) {
    await supabaseAdmin
      .from("call_sessions")
      .update({
        status: "completed",
        transcript: transcript || null,
        duration_seconds: extras?.durationSeconds ?? null,
        ended_at: new Date().toISOString(),
      })
      .eq("id", instant.call_session_id);
  }

  if (callSid) callTurns.delete(callSid);
  if (instant._memory) clearLiveTwilioCall(instant.id);

  if (io) {
    io.to(`user:${instant.user_id}`).emit("instant_call_completed", {
      instant_call_id: instant.id,
      summary,
      status: "completed",
    });
  }
}

export function twilioWebhooksRouter(io: SocketServer) {
  const router = Router();

  router.get("/config", (_req, res) => {
    const cfg = getTwilioConfig();
    res.json({
      configured: isTwilioConfigured(),
      live: isTwilioLive(),
      label: isTwilioLive() ? "LIVE" : isTwilioConfigured() ? "NEEDS_WEBHOOK_URL" : "ARCHITECTED",
      voice_url: cfg?.webhookBaseUrl ? `${cfg.webhookBaseUrl}/webhooks/twilio/voice` : null,
      gather_url: cfg?.webhookBaseUrl ? `${cfg.webhookBaseUrl}/webhooks/twilio/gather` : null,
      status_url: cfg?.webhookBaseUrl ? `${cfg.webhookBaseUrl}/webhooks/twilio/status` : null,
      from_number: cfg?.fromNumber ? `${cfg.fromNumber.slice(0, 4)}…` : null,
      setup:
        "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, and TWILIO_WEBHOOK_BASE_URL (public HTTPS, e.g. ngrok → :4000). Point the Twilio number Voice webhook to voice_url for inbound.",
    });
  });

  /**
   * Answer URL — start Mann-Mitra conversational gather loop.
   * Query: instant_call_id (from outbound) OR resolve by CallSid / From for inbound.
   */
  router.post("/voice", requireTwilioSignature, async (req, res, next) => {
    try {
      const p = twilioParams(req);
      const callSid = p.CallSid ?? "";
      let instantCallId = p.instant_call_id;

      let instant = await loadInstantContext(instantCallId, callSid);

      // Inbound: create instant_call if caller matches a victim phone
      if (!instant && p.From) {
        const fromDigits = p.From.replace(/\D/g, "").slice(-10);
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, preferred_language, phone_number")
          .eq("role", "victim")
          .limit(500);
        const match = (profiles ?? []).find((pr) =>
          (pr.phone_number ?? "").replace(/\D/g, "").endsWith(fromDigits)
        );
        if (match) {
          const { data: caseRow } = await supabaseAdmin
            .from("cases")
            .select("id")
            .eq("victim_id", match.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!caseRow) {
            sendTwiml(
              res,
              hangupTwiml(
                "We found your number but no case is linked yet. Please sign in to Samvedna or call NHAA 14566."
              )
            );
            return;
          }

          const { data: session } = await supabaseAdmin
            .from("call_sessions")
            .insert({
              case_id: caseRow.id,
              victim_id: match.id,
              call_type: "ai_voice",
              status: "in_progress",
              risk_level_at_call: "low",
              started_at: new Date().toISOString(),
            })
            .select()
            .single();

          const { data: created } = await supabaseAdmin
            .from("instant_calls")
            .insert({
              user_id: match.id,
              case_id: caseRow.id,
              call_session_id: session?.id ?? null,
              twilio_call_sid: callSid || null,
              status: "in_progress",
            })
            .select("*")
            .single();

          instant = created;
          instantCallId = created?.id;
        }
      }

      if (!instant) {
        sendTwiml(
          res,
          hangupTwiml(
            "Namaste. This is Samvedna. We could not match this number. Please use the Samvedna app, or call NHAA 14566."
          )
        );
        return;
      }

      if (instant && callSid && !instant.twilio_call_sid) {
        await supabaseAdmin
          .from("instant_calls")
          .update({ twilio_call_sid: callSid, status: "in_progress" })
          .eq("id", instant.id);
      }

      if (instant?.call_session_id) {
        await supabaseAdmin
          .from("call_sessions")
          .update({ status: "in_progress", started_at: new Date().toISOString() })
          .eq("id", instant.call_session_id);
      }

      const locale = await localeForUser(instant?.user_id);
      const greeting = greetingForLocale(locale);
      const id = instantCallId ?? instant?.id ?? "";

      if (callSid) {
        callTurns.set(callSid, [{ role: "assistant", content: greeting }]);
      }

      const gatherAction = `/webhooks/twilio/gather?instant_call_id=${encodeURIComponent(id)}`;
      sendTwiml(
        res,
        conversationalTwiml({
          sayText: greeting,
          actionPath: gatherAction,
          language: gatherLanguage(locale),
          hint: "feelings sleep worry court family today",
          retryActionPath: `/webhooks/twilio/voice?instant_call_id=${encodeURIComponent(id)}`,
        })
      );
    } catch (err) {
      next(err);
    }
  });

  /** Speech result → Mann-Mitra reply → gather again (or hang up). */
  router.post("/gather", requireTwilioSignature, async (req, res, next) => {
    try {
      const p = twilioParams(req);
      const callSid = p.CallSid ?? "";
      const speech = (p.SpeechResult ?? "").trim();
      const instantCallId = p.instant_call_id;
      const cfg = getTwilioConfig();
      const maxTurns = cfg?.maxTurns ?? 8;

      const instant = await loadInstantContext(instantCallId, callSid);
      const locale = await localeForUser(instant?.user_id);
      const id = instantCallId ?? instant?.id ?? "";

      const turns = callTurns.get(callSid) ?? [];
      const userTurns = turns.filter((t) => t.role === "user").length;

      if (!speech) {
        // Silence — gently re-prompt once, then close
        if (userTurns === 0) {
          sendTwiml(
            res,
            conversationalTwiml({
              sayText:
                locale === "hi"
                  ? "जब आप तैयार हों, कुछ कहें। मैं सुन रहा हूँ।"
                  : "Whenever you are ready, say something. I am listening.",
              actionPath: `/webhooks/twilio/gather?instant_call_id=${encodeURIComponent(id)}`,
              language: gatherLanguage(locale),
              retryActionPath: `/webhooks/twilio/gather?instant_call_id=${encodeURIComponent(id)}`,
            })
          );
          return;
        }
        sendTwiml(res, hangupTwiml(closingForLocale(locale)));
        if (id) await finalizeTwilioInstantCall(id, io);
        return;
      }

      turns.push({ role: "user", content: speech });
      const history = turns.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: t.content,
      }));

      const reply = await mannMitraReply(speech, history.slice(0, -1), locale);
      turns.push({ role: "assistant", content: reply });
      callTurns.set(callSid, turns);

      // Persist running transcript mid-call
      if (instant?.id) {
        const transcript = turnsToTranscript(turns);
        if (instant._memory) {
          updateLiveTwilioCall(instant.id, {
            transcript,
            status: "in_progress",
            twilioCallSid: callSid || instant.twilio_call_sid || undefined,
          });
        } else {
          await supabaseAdmin
            .from("instant_calls")
            .update({
              transcript,
              status: "in_progress",
              twilio_call_sid: callSid || instant.twilio_call_sid,
            })
            .eq("id", instant.id);
        }
      }

      const nextUserTurns = turns.filter((t) => t.role === "user").length;
      if (nextUserTurns >= maxTurns) {
        sendTwiml(
          res,
          hangupTwiml(`${reply} ${closingForLocale(locale)}`)
        );
        if (id) await finalizeTwilioInstantCall(id, io);
        return;
      }

      sendTwiml(
        res,
        conversationalTwiml({
          sayText: reply,
          actionPath: `/webhooks/twilio/gather?instant_call_id=${encodeURIComponent(id)}`,
          language: gatherLanguage(locale),
          retryActionPath: `/webhooks/twilio/gather?instant_call_id=${encodeURIComponent(id)}`,
        })
      );
    } catch (err) {
      next(err);
    }
  });

  /** Call progress / completion. */
  router.post("/status", requireTwilioSignature, async (req, res, next) => {
    try {
      const p = twilioParams(req);
      const callSid = p.CallSid ?? "";
      const callStatus = (p.CallStatus ?? "").toLowerCase();
      const duration = p.CallDuration ? parseInt(p.CallDuration, 10) : undefined;
      const instantCallId = p.instant_call_id;

      console.log("[Twilio] status", callSid, callStatus, p.AnsweredBy ?? "");

      if (instantCallId || callSid) {
        const instant = await loadInstantContext(instantCallId, callSid);
        if (instant) {
          if (callStatus === "ringing" || callStatus === "queued" || callStatus === "initiated") {
            if (instant._memory) {
              updateLiveTwilioCall(instant.id, {
                status: callStatus === "ringing" ? "ringing" : "initiated",
                twilioCallSid: callSid || undefined,
              });
            } else {
              await supabaseAdmin
                .from("instant_calls")
                .update({
                  status: callStatus === "ringing" ? "ringing" : "initiated",
                  twilio_call_sid: callSid || instant.twilio_call_sid,
                })
                .eq("id", instant.id);
            }
            io.to(`user:${instant.user_id}`).emit("instant_call_status", {
              instant_call_id: instant.id,
              status: callStatus,
              twilio_call_sid: callSid,
            });
          } else if (
            callStatus === "in-progress" ||
            callStatus === "answered"
          ) {
            if (instant._memory) {
              updateLiveTwilioCall(instant.id, {
                status: "in_progress",
                twilioCallSid: callSid || undefined,
              });
            } else {
              await supabaseAdmin
                .from("instant_calls")
                .update({ status: "in_progress", twilio_call_sid: callSid || instant.twilio_call_sid })
                .eq("id", instant.id);
            }
            io.to(`user:${instant.user_id}`).emit("instant_call_status", {
              instant_call_id: instant.id,
              status: "in_progress",
            });
          } else if (
            ["completed", "busy", "failed", "no-answer", "canceled"].includes(callStatus)
          ) {
            await finalizeTwilioInstantCall(instant.id, io, {
              callStatus,
              durationSeconds: Number.isFinite(duration) ? duration : undefined,
            });
          }
        }
      }

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Health ping without signature (Twilio console / our setup UI)
  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      configured: isTwilioConfigured(),
      live: isTwilioLive(),
      voice: getTwilioConfig()?.voice ?? null,
    });
  });

  return router;
}

/** Expose webhookUrl helper for outbound call wiring without circular imports. */
export { webhookUrl };
