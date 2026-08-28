import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import type { Server as SocketServer } from "socket.io";

const createCheckinSchema = z.object({
  case_id: z.string().uuid(),
  message: z.string().min(1).max(10000),
  channel: z.enum(["chat", "ivrs", "sms", "app", "ai_voice"]).optional().default("chat"),
});

export function checkinsRouter(io: SocketServer) {
  const router = Router();

  router.post("/", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const body = createCheckinSchema.parse(req.body);
      const userId = req.user!.id;

      const { data: caseRow } = await supabaseAdmin
        .from("cases")
        .select("id")
        .eq("id", body.case_id)
        .eq("victim_id", userId)
        .single();

      if (!caseRow) return res.status(404).json({ error: "Case not found" });

      const result = await createCheckinAndScore({
        caseId: body.case_id,
        victimId: userId,
        transcript: body.message,
        channel: body.channel,
        io,
      });

      res.status(201).json({
        checkin: result.checkin,
        distress_score: result.distressScore,
        alert: result.alert,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
