"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { CounsellorShell } from "@/components/counsellor-shell";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/utils";
import {
  connectSocket,
  joinHandoffRoom,
  onChatHandoffMessage,
} from "@/lib/socket";
import { Video } from "lucide-react";

type Msg = { id?: string; role: string; content: string; created_at?: string };

export default function CounsellorLiveChatPage() {
  const { id } = useParams<{ id: string }>();
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [victimLabel, setVictimLabel] = useState("Survivor");
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
      joinHandoffRoom(id);

      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();
      setName(prof?.full_name ?? "");

      try {
        await apiFetch(`/chat/handoff/${id}/join`, {
          method: "POST",
          token: session.access_token,
          body: "{}",
        });
        setJoined(true);
      } catch {
        /* may already be joined */
        setJoined(true);
      }

      try {
        const pending = await apiFetch<
          Array<{
            id: string;
            victimName: string;
            videoRoomUrl: string;
          }>
        >("/chat/handoff/pending", { token: session.access_token });
        const mine = pending.find((p) => p.id === id);
        if (mine) {
          setVictimLabel(mine.victimName || "Survivor");
          setVideoUrl(mine.videoRoomUrl);
        }
      } catch {
        /* ignore */
      }

      try {
        const msgs = await apiFetch<Msg[]>(`/chat/handoff/${id}/messages`, {
          token: session.access_token,
        });
        setMessages(msgs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load messages");
      }
    }
    init();
  }, [id]);

  useEffect(() => {
    return onChatHandoffMessage((event) => {
      if (event.handoff_id !== id) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === event.message.id)) return prev;
        return [...prev, event.message];
      });
    });
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !token || loading) return;
    const content = input.trim();
    setInput("");
    setLoading(true);
    try {
      const saved = await apiFetch<Msg>(`/chat/handoff/${id}/message`, {
        method: "POST",
        token,
        body: JSON.stringify({ content }),
      });
      setMessages((prev) => [...prev, { ...saved, role: "counsellor" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <CounsellorShell userName={name} userId={userId} token={token}>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sanctuary-ink-3)]">
              Live chat
            </p>
            <h1 className="font-display text-2xl text-[var(--sanctuary-ink)]">
              {victimLabel}
            </h1>
            <p className="text-sm text-[var(--sanctuary-ink-2)]">
              {joined ? "You are in this conversation." : "Joining…"}
            </p>
          </div>
          <div className="flex gap-2">
            {videoUrl && (
              <Button asChild>
                <a href={videoUrl} target="_blank" rel="noreferrer">
                  <Video className="mr-1.5 h-4 w-4" />
                  Video call
                </a>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/counselor/cases">Back to queue</Link>
            </Button>
          </div>
        </div>

        <div className="flex min-h-[60vh] flex-col rounded-xl border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)]">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => {
              const isCounsellor = m.role === "counsellor" || m.content.startsWith("[Counsellor]");
              const isUser = m.role === "user";
              const text = m.content.replace(/^\[Counsellor\]\s*/, "");
              return (
                <div
                  key={m.id ?? i}
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                    isCounsellor
                      ? "ml-auto bg-[var(--sanctuary-teal)] text-[#fdfbf7]"
                      : isUser
                        ? "bg-[var(--sanctuary-sand)]/50 text-[var(--sanctuary-ink)]"
                        : "bg-muted text-[var(--sanctuary-ink-2)]"
                  }`}
                >
                  {!isCounsellor && !isUser && (
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide opacity-70">
                      {m.role === "system" ? "System" : "Mann-Mitra"}
                    </p>
                  )}
                  {text}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          <form
            onSubmit={send}
            className="flex gap-2 border-t border-[var(--sanctuary-sand)] p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Write to the survivor…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--sanctuary-sand)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--sanctuary-teal)]"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </CounsellorShell>
  );
}
