"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { apiFetch } from "@/lib/utils";
import { CrisisSheet } from "@/components/crisis-sheet";

interface ChatMessage {
  id?: string;
  role: "assistant" | "user";
  content: string;
}

export default function VictimChatbotPage() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("en");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState("");
  const turnCount = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);

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
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            }))
          );
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
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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
    // Score every 3rd user turn to avoid flooding the pipeline
    const shouldScore = turnCount.current % 3 === 0;

    try {
      const data = await apiFetch<{
        response: string;
        tags?: string[];
      }>("/chat", {
        method: "POST",
        token,
        body: JSON.stringify({
          message: userMsg,
          preferred_language: locale,
          conversation_history: history.slice(0, -1).map((m) => ({
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat unavailable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell role="victim" userName={name}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 sm:gap-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold sm:text-2xl">Chatbot</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Private to you. Messages stay with your account only.
            </p>
          </div>
          <div className="shrink-0">
            <CrisisSheet locale={locale} />
          </div>
        </header>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="flex min-h-[min(60vh,420px)] flex-1 flex-col rounded-xl border bg-card sm:min-h-[420px]">
          <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
            {messages.map((m, i) => (
              <div
                key={m.id ?? i}
                className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed sm:max-w-[85%] sm:px-3.5 ${
                  m.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <p className="text-xs text-muted-foreground">Mann-Mitra is listening…</p>
            )}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t p-2.5 sm:p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type what feels safe…"
              className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2.5 text-sm outline-none ring-ring focus:ring-2"
              disabled={loading}
            />
            <Button type="submit" className="shrink-0" disabled={loading || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </AppShell>
  );
}
