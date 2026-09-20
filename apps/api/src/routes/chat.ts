import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { extractProblemTags } from "../lib/chat-tags";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import {
  getHandoff,
  listHandoffsForCounsellor,
  listOpenHandoffForVictim,
  registerHandoff,
  updateHandoff,
} from "../lib/chat-handoff-state";
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

      const userTurns =
        1 +
        body.conversation_history.filter((t) => t.role === "user" || t.role === "victim").length;
      const suggestHandoff = userTurns >= 3;
      const wantsHuman = /\b(counsellor|counselor|human|talk to someone|speak to (a |the )?counsellor|connect me|real person)\b/i.test(
        body.message
      );

      res.json({
        response: reply,
        reply,
        tags,
        distress_score_id: distressScoreId,
        suggest_handoff: suggestHandoff,
        wants_human: wantsHuman,
        user_turns: userTurns,
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

  /** Victim requests a live counsellor in this chat thread. */
  router.post("/handoff", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const { data: caseRow } = await supabaseAdmin
        .from("cases")
        .select("id, case_number, assigned_counsellor_id")
        .eq("victim_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();

      const open = listOpenHandoffForVictim(userId);
      if (open && open.status !== "ended") {
        return res.json({ handoff: open, already_open: true });
      }

      const id = randomUUID();
      const videoRoomUrl = `https://meet.jit.si/samvedna-${id.replace(/-/g, "").slice(0, 16)}`;
      const counsellorId = caseRow?.assigned_counsellor_id ?? null;

      const handoff = registerHandoff({
        id,
        victimId: userId,
        victimName: profile?.full_name ?? "Survivor",
        caseId: caseRow?.id ?? null,
        caseNumber: caseRow?.case_number ?? null,
        counsellorId,
        status: "requested",
        videoRoomUrl,
        createdAt: new Date().toISOString(),
        joinedAt: null,
      });

      const inserted = await supabaseAdmin
        .from("chat_handoffs")
        .insert({
          id,
          victim_id: userId,
          case_id: caseRow?.id ?? null,
          counsellor_id: counsellorId,
          status: "requested",
          video_room_url: videoRoomUrl,
        })
        .select()
        .maybeSingle();

      if (inserted.error) {
        console.warn("[chat] handoff table missing — memory only:", inserted.error.message);
      }

      await insertSystemMessage(
        userId,
        caseRow?.id ?? null,
        id,
        "Mann-Mitra is connecting you with your counsellor. They will join this chat shortly."
      );

      const payload = {
        handoff_id: id,
        victim_id: userId,
        victim_name: handoff.victimName,
        case_id: caseRow?.id ?? null,
        case_number: caseRow?.case_number ?? null,
        video_room_url: videoRoomUrl,
        message: `${handoff.victimName} asked to speak with a counsellor in chat.`,
      };

      if (counsellorId && io) {
        io.to(`user:${counsellorId}`).emit("counsellor_chat_request", payload);
      } else if (io) {
        // No assigned counsellor — notify every active counsellor profile
        const { data: counsellors } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("role", "counsellor");
        for (const c of counsellors ?? []) {
          io.to(`user:${c.id}`).emit("counsellor_chat_request", payload);
        }
      }
      if (caseRow?.id && io) {
        io.to(`case:${caseRow.id}`).emit("counsellor_chat_request", payload);
      }

      res.status(201).json({ handoff, notified: Boolean(counsellorId) });
    } catch (err) {
      next(err);
    }
  });

  /** Active / pending handoff for the victim. */
  router.get("/handoff/active", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const mem = listOpenHandoffForVictim(req.user!.id);
      if (mem) return res.json({ handoff: mem });

      const { data } = await supabaseAdmin
        .from("chat_handoffs")
        .select("*")
        .eq("victim_id", req.user!.id)
        .in("status", ["requested", "joined"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return res.json({ handoff: null });
      res.json({
        handoff: {
          id: data.id,
          victimId: data.victim_id,
          victimName: "",
          caseId: data.case_id,
          caseNumber: null,
          counsellorId: data.counsellor_id,
          status: data.status,
          videoRoomUrl: data.video_room_url,
          createdAt: data.created_at,
          joinedAt: data.joined_at,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /** Counsellor: list pending chat join requests. */
  router.get(
    "/handoff/pending",
    requireAuth,
    requireRole("counsellor", "admin"),
    async (req, res, next) => {
      try {
        const uid = req.user!.id;
        const mem = listHandoffsForCounsellor(uid);

        const { data } = await supabaseAdmin
          .from("chat_handoffs")
          .select(
            "id, victim_id, case_id, counsellor_id, status, video_room_url, created_at, joined_at"
          )
          .or(`counsellor_id.eq.${uid},counsellor_id.is.null`)
          .in("status", ["requested", "joined"])
          .order("created_at", { ascending: false })
          .limit(20);

        const fromDb = (data ?? []).map((d) => ({
          id: d.id as string,
          victimId: d.victim_id as string,
          victimName: "",
          caseId: (d.case_id as string) ?? null,
          caseNumber: null as string | null,
          counsellorId: (d.counsellor_id as string) ?? null,
          status: d.status as "requested" | "joined" | "ended",
          videoRoomUrl: d.video_room_url as string,
          createdAt: d.created_at as string,
          joinedAt: (d.joined_at as string) ?? null,
        }));

        // Enrich names
        const ids = [...new Set([...mem, ...fromDb].map((h) => h.victimId))];
        const { data: profiles } = ids.length
          ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids)
          : { data: [] as Array<{ id: string; full_name: string }> };
        const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

        const merged = new Map<string, (typeof mem)[0]>();
        for (const h of [...fromDb, ...mem]) {
          merged.set(h.id, {
            ...h,
            victimName: nameById.get(h.victimId) ?? (h.victimName || "Survivor"),
          });
        }

        res.json([...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      } catch (err) {
        next(err);
      }
    }
  );

  /** Counsellor joins the chat handoff. */
  router.post(
    "/handoff/:id/join",
    requireAuth,
    requireRole("counsellor", "admin"),
    async (req, res, next) => {
      try {
        const id = String(req.params.id);
        const uid = req.user!.id;
        let handoff = getHandoff(id);

        if (!handoff) {
          const { data } = await supabaseAdmin
            .from("chat_handoffs")
            .select("*")
            .eq("id", id)
            .maybeSingle();
          if (!data) return res.status(404).json({ error: "Handoff not found" });
          handoff = registerHandoff({
            id: data.id,
            victimId: data.victim_id,
            victimName: "Survivor",
            caseId: data.case_id,
            caseNumber: null,
            counsellorId: data.counsellor_id,
            status: data.status,
            videoRoomUrl: data.video_room_url,
            createdAt: data.created_at,
            joinedAt: data.joined_at,
          });
        }

        const updated = updateHandoff(id, {
          status: "joined",
          counsellorId: uid,
          joinedAt: new Date().toISOString(),
        });

        await supabaseAdmin
          .from("chat_handoffs")
          .update({
            status: "joined",
            counsellor_id: uid,
            joined_at: new Date().toISOString(),
          })
          .eq("id", id);

        await insertSystemMessage(
          handoff.victimId,
          handoff.caseId,
          id,
          "Your counsellor has joined this conversation."
        );

        if (io) {
          io.to(`user:${handoff.victimId}`).emit("counsellor_joined_chat", {
            handoff_id: id,
            counsellor_id: uid,
            video_room_url: handoff.videoRoomUrl,
          });
          io.to(`handoff:${id}`).emit("counsellor_joined_chat", {
            handoff_id: id,
            counsellor_id: uid,
          });
        }

        res.json({ handoff: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  /** Shared thread messages for a handoff (victim or joined counsellor). */
  router.get("/handoff/:id/messages", requireAuth, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const handoff = await resolveHandoff(id);
      if (!handoff) return res.status(404).json({ error: "Not found" });

      const uid = req.user!.id;
      const role = req.user!.role;
      const allowed =
        role === "admin" ||
        handoff.victimId === uid ||
        handoff.counsellorId === uid ||
        (role === "counsellor" && handoff.status === "requested");
      if (!allowed) return res.status(403).json({ error: "Access denied" });

      const { data, error } = await supabaseAdmin
        .from("chat_messages")
        .select("id, role, content, created_at, handoff_id")
        .eq("user_id", handoff.victimId)
        .order("created_at", { ascending: true })
        .limit(300);

      if (error) {
        // Fallback without handoff_id column
        const basic = await supabaseAdmin
          .from("chat_messages")
          .select("id, role, content, created_at")
          .eq("user_id", handoff.victimId)
          .order("created_at", { ascending: true })
          .limit(300);
        return res.json(basic.data ?? []);
      }
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  /** Live message while counsellor is in the thread (victim or counsellor). */
  router.post("/handoff/:id/message", requireAuth, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const body = z.object({ content: z.string().min(1).max(5000) }).parse(req.body);
      const handoff = await resolveHandoff(id);
      if (!handoff) return res.status(404).json({ error: "Not found" });

      const uid = req.user!.id;
      const role = req.user!.role;
      const isVictim = handoff.victimId === uid;
      const isCounsellor =
        role === "counsellor" || role === "admin"
          ? handoff.counsellorId === uid || handoff.status === "joined" || role === "admin"
          : false;

      if (!isVictim && !isCounsellor && !(role === "counsellor" && handoff.counsellorId === uid)) {
        // Allow assigned counsellor even mid-join
        if (!(role === "counsellor" && (handoff.counsellorId === uid || !handoff.counsellorId))) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const msgRole = isVictim ? "user" : "counsellor";
      const row = {
        user_id: handoff.victimId,
        case_id: handoff.caseId,
        role: msgRole,
        content: body.content,
        handoff_id: id,
      };

      let saved: { id: string; role: string; content: string; created_at: string } | null = null;
      const { data, error } = await supabaseAdmin
        .from("chat_messages")
        .insert(row)
        .select("id, role, content, created_at")
        .single();

      if (error) {
        const fallback = await supabaseAdmin
          .from("chat_messages")
          .insert({
            user_id: handoff.victimId,
            case_id: handoff.caseId,
            role: msgRole === "counsellor" ? "assistant" : msgRole,
            content:
              msgRole === "counsellor" ? `[Counsellor] ${body.content}` : body.content,
          })
          .select("id, role, content, created_at")
          .single();
        if (fallback.error || !fallback.data) {
          return res.status(500).json({ error: "Failed to save message" });
        }
        saved = {
          ...fallback.data,
          role: msgRole,
          content: body.content,
        };
      } else {
        saved = data;
      }

      if (io) {
        const event = {
          handoff_id: id,
          message: saved,
        };
        io.to(`user:${handoff.victimId}`).emit("chat_handoff_message", event);
        if (handoff.counsellorId) {
          io.to(`user:${handoff.counsellorId}`).emit("chat_handoff_message", event);
        }
        io.to(`handoff:${id}`).emit("chat_handoff_message", event);
      }

      res.status(201).json(saved);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function insertSystemMessage(
  victimId: string,
  caseId: string | null,
  handoffId: string,
  content: string
) {
  const { error } = await supabaseAdmin.from("chat_messages").insert({
    user_id: victimId,
    case_id: caseId,
    role: "system",
    content,
    handoff_id: handoffId,
  });
  if (error) {
    await supabaseAdmin.from("chat_messages").insert({
      user_id: victimId,
      case_id: caseId,
      role: "assistant",
      content,
    });
  }
}

async function resolveHandoff(id: string) {
  const mem = getHandoff(id);
  if (mem) return mem;
  const { data } = await supabaseAdmin.from("chat_handoffs").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return registerHandoff({
    id: data.id,
    victimId: data.victim_id,
    victimName: "Survivor",
    caseId: data.case_id,
    caseNumber: null,
    counsellorId: data.counsellor_id,
    status: data.status,
    videoRoomUrl: data.video_room_url,
    createdAt: data.created_at,
    joinedAt: data.joined_at,
  });
}
