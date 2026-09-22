"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { apiFetch } from "@/lib/utils";
import { CrisisSheet } from "@/components/crisis-sheet";
import {
  connectSocket,
  joinHandoffRoom,
  onChatHandoffMessage,
  onCounsellorJoinedChat,
} from "@/lib/socket";
import { Video, UserRound } from "lucide-react";

interface ChatMessage {
  id?: string;
  role: "assistant" | "user" | "system" | "counsellor";
  content: string;
}

type Handoff = {
  id: string;
  status: "requested" | "joined" | "ended";
  videoRoomUrl?: string;
  video_room_url?: string;
  counsellorId?: string | null;
};

export default function VictimChatbotPage() {
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("en");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [showHandoffOffer, setShowHandoffOffer] = useState(false);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const turnCount = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const offeredRef = useRef(false);

  const liveMode = handoff?.status === "joined" || handoff?.status === "requested";
  const videoUrl = handoff?.videoRoomUrl ?? handoff?.video_room_url ?? null;

  const refreshHandoff = useCallback(async (accessToken: string) => {
    try {
      const data = await apiFetch<{ handoff: Handoff | null }>("/chat/handoff/active", {
        token: accessToken,
      });
      if (data.handoff) {
        setHandoff(data.handoff);
        joinHandoffRoom(data.handoff.id);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      setUserId(session.user.id);
      connectSocket(session.user.id);

      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, preferred_language")
        .eq("id", session.user.id)
        .maybeSingle();
      setName(prof?.full_name ?? "");
      setLocale(prof?.preferred_language ?? "en");

      try {
        const history = await apiFetch<ChatMessage[]>("/chat/history", {
          token: session.access_token,
        });
        if (history.length) {
          setMessages(
            history.map((m) => ({
              id: m.id,
              role: (m.role as ChatMessage["role"]) || "assistant",
              content: m.content,
            }))
          );
          turnCount.current = history.filter((m) => m.role === "user").length;
        } else {
          setMessages([
            {
              role: "assistant",
              content:
                "I'm Mann-Mitra. Whenever you're ready, share how today has been — only what feels safe.",
            },
          ]);
        }
        const tagRows = await apiFetch<Array<{ tag: string }>>("/chat/tags", {
          token: session.access_token,
        });
        setTags(tagRows.map((t) => t.tag));
        await refreshHandoff(session.access_token);
      } catch {
        setMessages([
          {
            role: "assistant",
            content:
              "I'm Mann-Mitra. Whenever you're ready, share how today has been — only what feels safe.",
          },
        ]);
      }
    }
    init();
  }, [refreshHandoff]);

  useEffect(() => {
    if (!userId) return;
    const offJoin = onCounsellorJoinedChat((event) => {
      setHandoff((h) =>
        h && h.id === event.handoff_id
          ? {
              ...h,
              status: "joined",
              videoRoomUrl: event.video_room_url ?? h.videoRoomUrl,
            }
          : h
      );
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: "Your counsellor has joined this conversation.",
        },
      ]);
    });
    const offMsg = onChatHandoffMessage((event) => {
      if (handoff && event.handoff_id !== handoff.id) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === event.message.id)) return prev;
        return [
          ...prev,
          {
            id: event.message.id,
            role: event.message.role as ChatMessage["role"],
            content: event.message.content,
          },
        ];
      });
    });
    return () => {
      offJoin();
      offMsg();
    };
  }, [userId, handoff]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function requestHandoff() {
    if (!token || handoffBusy) return;
    setHandoffBusy(true);
    setError("");
    try {
      const data = await apiFetch<{
        handoff: Handoff & { videoRoomUrl: string };
      }>("/chat/handoff", { method: "POST", token, body: "{}" });
      setHandoff(data.handoff);
      setShowHandoffOffer(false);
      joinHandoffRoom(data.handoff.id);
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content:
            "Connecting you with your counsellor. They'll get a notification and can join this chat. You can also start a video call when you're ready.",
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request counsellor");
    } finally {
      setHandoffBusy(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !token || loading) return;
    const userMsg = input.trim();
    setInput("");
    const history = [...messages, { role: "user" as const, content: userMsg }];
    setMessages(history);
    setLoading(true);
    setError("");
    turnCount.current += 1;

    // Live counsellor mode — skip AI
    if (liveMode && handoff?.id) {
      try {
        const saved = await apiFetch<ChatMessage>(`/chat/handoff/${handoff.id}/message`, {
          method: "POST",
          token,
          body: JSON.stringify({ content: userMsg }),
        });
        setMessages((prev) => {
          const withoutOptimisticDup = prev.slice(0, -1);
          return [...withoutOptimisticDup, { ...saved, role: "user" }];
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Message failed");
      } finally {
        setLoading(false);
      }
      return;
    }

    const shouldScore = turnCount.current % 3 === 0;

    try {
      const data = await apiFetch<{
        response: string;
        tags?: string[];
        suggest_handoff?: boolean;
        wants_human?: boolean;
      }>("/chat", {
        method: "POST",
        token,
        body: JSON.stringify({
          message: userMsg,
          preferred_language: locale,
          conversation_history: history
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(0, -1)
            .map((m) => ({
              role: m.role,
              content: m.content,
            })),
          persist: true,
          score: shouldScore,
        }),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
      if (data.tags?.length) {
        setTags((prev) => [...new Set([...prev, ...data.tags!])]);
      }
      if ((data.suggest_handoff || data.wants_human) && !offeredRef.current && !handoff) {
        offeredRef.current = true;
        setShowHandoffOffer(true);
      }
      if (data.wants_human && !handoff) {
        await requestHandoff();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat unavailable");
    } finally {
      setLoading(false);
    }
  }

  function bubbleClass(role: ChatMessage["role"]) {
    if (role === "user") return "ml-auto bg-primary text-primary-foreground";
    if (role === "counsellor") return "border border-primary/30 bg-primary/10 text-foreground";
    if (role === "system") return "mx-auto max-w-full bg-transparent text-center text-xs text-muted-foreground";
    return "bg-muted text-foreground";
  }

  function label(role: ChatMessage["role"]) {
    if (role === "counsellor") return "Counsellor";
    if (role === "system") return null;
    if (role === "user") return null;
    return "Mann-Mitra";
  }

  return (
    <AppShell role="victim" userName={name} flush>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col lg:p-6">
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col bg-card lg:overflow-hidden lg:rounded-xl lg:border">
        <header className="shrink-0 space-y-2 border-b px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold leading-tight sm:text-2xl">Chatbot</h1>
              <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground sm:text-sm">
                {handoff?.status === "joined"
                  ? "Your counsellor is in this conversation."
                  : handoff?.status === "requested"
                    ? "Waiting for your counsellor to join…"
                    : "Private to you. A counsellor can join when you want."}
              </p>
            </div>
            <div className="shrink-0 pt-0.5 text-xs">
              <CrisisSheet locale={locale} />
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              disabled={handoffBusy || handoff?.status === "joined"}
              onClick={() => void requestHandoff()}
            >
              <UserRound className="mr-1.5 h-3.5 w-3.5" />
              {handoff ? "Requested" : "Connect counsellor"}
            </Button>
            {videoUrl && (
              <Button type="button" size="sm" className="h-9 shrink-0" asChild>
                <a href={videoUrl} target="_blank" rel="noreferrer">
                  <Video className="mr-1.5 h-3.5 w-3.5" />
                  Video call
                </a>
              </Button>
            )}
          </div>
        </header>

        {showHandoffOffer && !handoff && (
          <div className="shrink-0 border-b border-primary/20 bg-primary/[0.04] px-3 py-3 text-sm sm:px-4">
            <p className="text-foreground">
              Would it help to bring your counsellor into this chat?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" className="h-9" onClick={() => void requestHandoff()} disabled={handoffBusy}>
                Yes, connect me
              </Button>
              <Button size="sm" className="h-9" variant="ghost" onClick={() => setShowHandoffOffer(false)}>
                Not now
              </Button>
            </div>
          </div>
        )}

        {tags.length > 0 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto border-b px-3 py-2 sm:px-4">
            {tags.map((t) => (
              <span
                key={t}
                className="shrink-0 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
          {messages.map((m, i) => (
            <div
              key={m.id ?? i}
              className={`w-fit max-w-[88%] sm:max-w-[85%] ${
                m.role === "user" ? "ml-auto" : m.role === "system" ? "mx-auto max-w-full" : ""
              }`}
            >
              {label(m.role) && (
                <p className="mb-0.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label(m.role)}
                </p>
              )}
              <div
                className={`break-words rounded-2xl px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere] sm:px-3.5 ${bubbleClass(m.role)}`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <p className="text-xs text-muted-foreground">
              {liveMode ? "Sending…" : "Mann-Mitra is listening…"}
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="shrink-0 px-3 pb-1 text-sm text-destructive sm:px-4" role="alert">
            {error}
          </p>
        )}

        <form
          onSubmit={send}
          className="flex shrink-0 items-end gap-2 border-t bg-card px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              handoff?.status === "joined"
                ? "Message your counsellor…"
                : "Type what feels safe…"
            }
            enterKeyHint="send"
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 py-2.5 text-base outline-none ring-ring focus:ring-2 sm:text-sm"
            disabled={loading}
          />
          {videoUrl && (
            <Button type="button" variant="outline" className="h-11 w-11 shrink-0 px-0" asChild>
              <a href={videoUrl} target="_blank" rel="noreferrer" title="Video call with counsellor">
                <Video className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button type="submit" className="h-11 shrink-0 px-4" disabled={loading || !input.trim()}>
            Send
          </Button>
        </form>
      </div>
      </div>
    </AppShell>
  );
}
