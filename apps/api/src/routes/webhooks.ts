import { Router, type RequestHandler } from "express";
import type { Server as SocketServer } from "socket.io";
import { exotelWebhooksRouter } from "./exotel-webhooks";
import { twilioWebhooksRouter } from "./twilio-webhooks";

/**
 * Telephony webhooks — Exotel (India IVRS/SMS) + Twilio Conversational Voice.
 */
export function webhooksRouter(io: SocketServer) {
  const router = Router();
  const exotel = exotelWebhooksRouter(io);
  const twilioHooks = twilioWebhooksRouter(io);

  const forward =
    (path: string): RequestHandler =>
    (req, res, next) => {
      const orig = req.url;
      req.url = path;
      exotel(req, res, (err) => {
        req.url = orig;
        next(err);
      });
    };

  router.use("/exotel", exotel);
  router.use("/twilio", twilioHooks);
  router.all("/ivrs-webhook", forward("/exoml/inbound"));
  router.post("/sms-webhook", forward("/sms/inbound"));

  return router;
}
