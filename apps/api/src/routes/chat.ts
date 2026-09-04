import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { extractProblemTags } from "../lib/chat-tags";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import type { Server as SocketServer } from "socket.io";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";
const CHAT_TIMEOUT_MS = 25_000;

const FALLBACK_REPLIES: Record<string, string> = {
  en: "I am having trouble replying just now, but I have not gone anywhere and what you said has been saved. If you need someone immediately: NHAA helpline 14566, Tele-MANAS 14416, KIRAN 1800-599-0019, or emergency 112.",
  hi: "मुझे अभी जवाब देने में दिक्कत हो रही है, लेकिन आपकी बात सुरक्षित रख ली गई है। तुरंत मदद: NHAA 14566, Tele-MANAS 14416, KIRAN 1800-599-0019, या आपातकाल 112।",
  ta: "இப்போது பதிலளிப்பதில் சிக்கல் உள்ளது, ஆனால் நீங்கள் சொன்னது பாதுகாக்கப்பட்டுள்ளது. உடனடி உதவி: NHAA 14566, Tele-MANAS 14416, KIRAN 1800-599-0019, அல்லது 112.",
};

async function upsertTags(userId: string, tags: string[]) {
  for (const tag of tags) {
    const { data: existing } = await supabaseAdmin
      .from("user_problem_tags")
      .select("id")
      .eq("user_id", userId)
      .eq("tag", tag)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("user_problem_tags")
        .update({ last_seen_at: new Date().toISOString(), source: "chat" })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("user_problem_tags").insert({
        user_id: userId,
        tag,
        source: "chat",
      });
    }
  }
}

export function chatRouter(io?: SocketServer) {
  const router = Router();

  const chatSchema = z.object({
    message: z.string().min(1).max(5000),
    preferred_language: z.string().default("en"),
    conversation_history: z
      .array(z.object({ role: z.string(), content: z.string() }))
      .default([]),
    /** Persist to chat_messages + extract tags + optionally score */
    persist: z.boolean().default(true),
    /** When true, also run distress scoring on this turn (batched by client every N turns) */
    score: z.boolean().default(false),
  });

  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const body = chatSchema.parse(req.body);
      const userId = req.user!.id;

      const fallbackText = FALLBACK_REPLIES[body.preferred_language] ?? FALLBACK_REPLIES.en;
      const fallback = () =>
        res.status(200).json({
          response: fallbackText,
          reply: fallbackText,
          degraded: true,
          source: "api_fallback",
          tags: [],
          honesty:
            "The companion service did not respond in time. This is a fixed safety message, not a generated reply.",
        });

      let reply = "";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

      try {
        const mlRes = await fetch(`${ML_SERVICE_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: body.message,
            preferred_language: body.preferred_language,
            conversation_history: body.conversation_history,
          }),
          signal: controller.signal,
        });

        if (!mlRes.ok) {
          console.error(`[Chat proxy] ML error ${mlRes.status}: ${await mlRes.text()}`);
          clearTimeout(timeout);
          return fallback();
        }

        const data = (await mlRes.json()) as { response?: string; reply?: string };
        reply = (data.response ?? data.reply ?? "").trim() || fallbackText;
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        console.error(
          `[Chat proxy] ${aborted ? `timed out after ${CHAT_TIMEOUT_MS}ms` : "request failed"}`,
          err instanceof Error ? err.message : err
        );
        clearTimeout(timeout);
        return fallback();
      } finally {
        clearTimeout(timeout);
      }

      const tags = extractProblemTags(body.message);
      let distressScoreId: string | null = null;

      if (body.persist && req.user!.role === "victim") {
        try {
          const { data: caseRow } = await supabaseAdmin
            .from("cases")
            .select("id")
            .eq("victim_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const { error: msgErr } = await supabaseAdmin.from("chat_messages").insert([
            {
              user_id: userId,
              case_id: caseRow?.id ?? null,
              role: "user",
              content: body.message,
            },
            {
              user_id: userId,
              case_id: caseRow?.id ?? null,
              role: "assistant",
              content: reply,
            },
          ]);
          if (msgErr) {
            console.warn("[chat] persist skipped:", msgErr.message);
          } else if (tags.length) {
            await upsertTags(userId, tags);
          }

          if (body.score && caseRow?.id) {
            try {
              const scored = await createCheckinAndScore({
                caseId: caseRow.id,
                victimId: userId,
                transcript: body.message,
                channel: "chatbot",
                io,
              });
              distressScoreId = scored.distressScore?.id ?? null;
            } catch (err) {
              console.warn("[chat] scoring failed:", err instanceof Error ? err.message : err);
            }
          }
        } catch (err) {
          console.warn("[chat] persist failed:", err instanceof Error ? err.message : err);
        }
      }

      res.json({
        response: reply,
        reply,
        tags,
        distress_score_id: distressScoreId,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/history", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_messages")
        .select("id, role, content, created_at")
        .eq("user_id", req.user!.id)
        .order("created_at", { ascending: true })
        .limit(200);

      // Table may not exist until victim_dashboard migration is applied
      if (error) {
        console.warn("[chat] history unavailable:", error.message);
        return res.json([]);
      }
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  router.get("/tags", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("user_problem_tags")
        .select("tag, last_seen_at, source")
        .eq("user_id", req.user!.id)
        .order("last_seen_at", { ascending: false });

      if (error) {
        console.warn("[chat] tags unavailable:", error.message);
        return res.json([]);
      }
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
