import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import { getLatestRisk, lookupVictimByPhone, routeCallType } from "../lib/call-routing";
import { getExotelConfig, isExotelConfigured } from "../lib/exotel";
import {
  counsellorBridgeExoml,
  recordCheckinExoml,
  unknownCallerExoml,
} from "../lib/exoml";
import { normalizePhone } from "../lib/phone";
import type { Server as SocketServer } from "socket.io";
import type { IncomingCallEvent } from "@samvedna/shared-types";

/** Exotel sends form fields on GET/POST — merge query + body. */
function exotelParams(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...req.query, ...req.body })) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function sendExoml(res: Response, xml: string) {
  res.type("application/xml").send(xml);
}

export function exotelWebhooksRouter(io: SocketServer) {
  const router = Router();

  /** Health / setup info for Exotel dashboard configuration. */
  router.get("/config", (_req, res) => {
    const cfg = getExotelConfig();
    res.json({
      configured: isExotelConfigured(),
      inbound_exoml_url: cfg?.webhookBaseUrl ? `${cfg.webhookBaseUrl}/webhooks/exotel/exoml/inbound` : null,
      passthru_url: cfg?.webhookBaseUrl ? `${cfg.webhookBaseUrl}/webhooks/exotel/passthru` : null,
      voice_status_url: cfg?.webhookBaseUrl ? `${cfg.webhookBaseUrl}/webhooks/exotel/voice/status` : null,
      recording_url: cfg?.webhookBaseUrl ? `${cfg.webhookBaseUrl}/webhooks/exotel/voice/recording` : null,
      sms_inbound_url: cfg?.webhookBaseUrl ? `${cfg.webhookBaseUrl}/webhooks/exotel/sms/inbound` : null,
      setup:
        "In Exotel App Bazaar: create inbound flow → URL applet → inbound_exoml_url. Point SMS to sms_inbound_url.",
    });
  });

  /**
   * Dynamic ExoML for inbound IVRS — set as URL in Exotel URL applet.
   * Routes high/critical → dial counsellor; low/moderate → record check-in.
   */
  router.all("/exoml/inbound", async (req, res, next) => {
    try {
      const p = exotelParams(req);
      const from = p.CallFrom ?? p.From ?? p.from ?? "";
      console.log("[Exotel] inbound ExoML:", from, p.CallSid ?? "");

      const victim = await lookupVictimByPhone(from);
      if (!victim) {
        return sendExoml(res, unknownCallerExoml());
      }

      const { risk_level, score } = await getLatestRisk(victim.case_id);
      const call_type = routeCallType(risk_level);
      const cfg = getExotelConfig();
      const recordingUrl = cfg?.webhookBaseUrl
        ? `${cfg.webhookBaseUrl}/webhooks/exotel/voice/recording`
        : "";

      if (call_type === "counsellor" && victim.assigned_counsellor_id && victim.counsellor_phone) {
        const { data: session } = await supabaseAdmin
          .from("call_sessions")
          .insert({
            case_id: victim.case_id,
            victim_id: victim.id,
            counsellor_id: victim.assigned_counsellor_id,
            call_type: "counsellor",
            status: "ringing",
            risk_level_at_call: risk_level,
            distress_score_at_call: score,
            exotel_call_sid: p.CallSid ?? null,
          })
          .select()
          .single();

        if (session) {
          io.to(`user:${victim.assigned_counsellor_id}`).emit("incoming_call", {
            call_session: session,
            case_number: victim.case_number,
            victim_name: victim.full_name,
            call_type: "counsellor",
          } satisfies IncomingCallEvent);
        }

        return sendExoml(
          res,
          counsellorBridgeExoml(victim.counsellor_phone, victim.counsellor_name ?? "counsellor")
        );
      }

      await supabaseAdmin.from("call_sessions").insert({
        case_id: victim.case_id,
        victim_id: victim.id,
        counsellor_id: null,
        call_type: "ai_voice",
        status: "in_progress",
        risk_level_at_call: risk_level,
        distress_score_at_call: score,
        exotel_call_sid: p.CallSid ?? null,
      });

      const lang = (victim.preferred_language === "hi" || victim.preferred_language === "ta"
        ? victim.preferred_language
        : "en") as "en" | "hi" | "ta";

      if (!recordingUrl) {
        return sendExoml(res, unknownCallerExoml());
      }

      return sendExoml(res, recordCheckinExoml(recordingUrl, lang));
    } catch (err) {
      next(err);
    }
  });

  /**
   * Passthru applet — binary routing without dynamic ExoML.
   * 200 → counsellor branch in Exotel flow; 302 → record/AI branch.
   */
  router.all("/passthru", async (req, res, next) => {
    try {
      const p = exotelParams(req);
      const from = p.CallFrom ?? p.From ?? "";
      const victim = await lookupVictimByPhone(from);

      if (!victim) {
        return res.sendStatus(302);
      }

      const { risk_level } = await getLatestRisk(victim.case_id);
      const call_type = routeCallType(risk_level);

      if (call_type === "counsellor" && victim.assigned_counsellor_id) {
        await supabaseAdmin.from("call_sessions").insert({
          case_id: victim.case_id,
          victim_id: victim.id,
          counsellor_id: victim.assigned_counsellor_id,
          call_type: "counsellor",
          status: "requested",
          risk_level_at_call: risk_level,
          exotel_call_sid: p.CallSid ?? null,
        });
        return res.sendStatus(200);
      }

      return res.sendStatus(302);
    } catch (err) {
      next(err);
    }
  });

  /** Recording complete — score IVRS check-in. */
  router.all("/voice/recording", async (req, res, next) => {
    try {
      const p = exotelParams(req);
      console.log("[Exotel] recording:", JSON.stringify(p).slice(0, 600));

      const from = p.CallFrom ?? p.From ?? "";
      const recordingUrl = p.RecordingUrl ?? p.recording_url ?? "";
      const digits = p.Digits ?? "";
      const transcript = p.TranscriptionText ?? p.transcription ?? digits;

      const victim = await lookupVictimByPhone(from);
      if (!victim) {
        return sendExoml(res, unknownCallerExoml());
      }

      const note = transcript.trim() || (recordingUrl ? `[IVRS recording: ${recordingUrl}]` : "");
      if (note) {
        await createCheckinAndScore({
          caseId: victim.case_id,
          victimId: victim.id,
          transcript: note,
          channel: "ivrs",
          io,
        });
      }

      const { data: openSession } = await supabaseAdmin
        .from("call_sessions")
        .select("id")
        .eq("victim_id", victim.id)
        .eq("call_type", "ai_voice")
        .in("status", ["in_progress", "ringing", "requested"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openSession) {
        await supabaseAdmin
          .from("call_sessions")
          .update({
            status: "completed",
            transcript: note || null,
            ended_at: new Date().toISOString(),
          })
          .eq("id", openSession.id);
      }

      sendExoml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="woman">Thank you. Your check-in has been saved. Take care.</Say><Hangup/></Response>`
      );
    } catch (err) {
      next(err);
    }
  });

  /** Call status terminal events — update sessions, store recording URL. */
  router.post("/voice/status", async (req, res, next) => {
    try {
      const p = exotelParams(req);
      console.log("[Exotel] status:", p.Status, p.CallSid, p.CustomField ?? "");

      const callSid = p.CallSid ?? "";
      const status = (p.Status ?? "").toLowerCase();
      const customField = p.CustomField ?? "";
      const recordingUrl = p.RecordingUrl ?? "";
      const duration = parseInt(p.Duration ?? "0", 10) || null;

      if (customField.startsWith("session:")) {
        const sessionId = customField.replace("session:", "");
        const updates: Record<string, unknown> = {};

        if (status === "completed") {
          updates.status = "completed";
          updates.ended_at = new Date().toISOString();
          if (duration) updates.duration_seconds = duration;
        } else if (status === "no-answer" || status === "busy") {
          updates.status = "missed";
          updates.ended_at = new Date().toISOString();
        } else if (status === "failed") {
          updates.status = "cancelled";
          updates.ended_at = new Date().toISOString();
        }

        if (recordingUrl && !updates.transcript) {
          updates.transcript = `[Recording: ${recordingUrl}]`;
        }

        if (Object.keys(updates).length) {
          await supabaseAdmin.from("call_sessions").update(updates).eq("id", sessionId);
        }
      } else if (callSid) {
        const updates: Record<string, unknown> = { exotel_call_sid: callSid };
        if (status === "completed") {
          updates.status = "completed";
          updates.ended_at = new Date().toISOString();
          if (duration) updates.duration_seconds = duration;
        }
        await supabaseAdmin.from("call_sessions").update(updates).eq("exotel_call_sid", callSid);
      }

      res.json({ received: true });
    } catch (err) {
      next(err);
    }
  });

  /** Inbound SMS from Exotel. */
  router.post("/sms/inbound", async (req, res, next) => {
    try {
      const p = exotelParams(req);
      const from = p.From ?? p.from ?? "";
      const text = p.Body ?? p.body ?? p.text ?? "";

      if (!from || !text.trim()) {
        return res.status(400).json({ error: "Missing From or Body" });
      }

      const victim = await lookupVictimByPhone(from);
      if (!victim) {
        return res.json({ received: true, matched: false });
      }

      const message = text.replace(/^SAMVEDNA\s*/i, "").trim();
      await createCheckinAndScore({
        caseId: victim.case_id,
        victimId: victim.id,
        transcript: message,
        channel: "sms",
        io,
      });

      res.json({ received: true, scored: true });
    } catch (err) {
      next(err);
    }
  });

  router.post("/sms/status", (req, res) => {
    console.log("[Exotel] SMS status:", JSON.stringify(exotelParams(req)).slice(0, 300));
    res.json({ received: true });
  });

  return router;
}
