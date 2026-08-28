import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

export function chatRouter() {
  const router = Router();

  const chatSchema = z.object({
    message: z.string().min(1).max(5000),
    preferred_language: z.string().default("en"),
    conversation_history: z
      .array(z.object({ role: z.string(), content: z.string() }))
      .default([]),
  });

  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const body = chatSchema.parse(req.body);

      const mlRes = await fetch(`${ML_SERVICE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!mlRes.ok) {
        const errText = await mlRes.text();
        console.error("[Chat proxy] ML error:", errText);
        return res.status(502).json({ error: "Chat service unavailable", detail: errText });
      }

      const data = await mlRes.json();
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
