import { Router, type RequestHandler } from "express";
import type { Server as SocketServer } from "socket.io";
import { exotelWebhooksRouter } from "./exotel-webhooks";

/**
 * Telephony webhooks — Exotel is the primary provider for India (IVRS, SMS, outbound bridge).
 * Legacy paths (/ivrs-webhook, /sms-webhook) forward to Exotel handlers.
 */
export function webhooksRouter(io: SocketServer) {
  const router = Router();
  const exotel = exotelWebhooksRouter(io);

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
  router.all("/ivrs-webhook", forward("/exoml/inbound"));
  router.post("/sms-webhook", forward("/sms/inbound"));

  return router;
}
