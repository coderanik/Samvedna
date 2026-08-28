"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { CrisisNotice } from "@/components/crisis-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import { getMessages, type Locale } from "@/i18n/messages";
import { Send, Loader2, Phone, AlertCircle } from "lucide-react";
import type { Case, CaseWithDetails, CreateCheckinResponse } from "@samvedna/shared-types";

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

const GREETINGS: Record<string, string> = {
  en: "Hello. I'm Mann-Mitra, here to check in on how you're doing — no rush, no judgment. How have you been feeling lately?",
  hi: "नमस्ते। मैं मन-मित्र हूँ, यह जानने के लिए कि आप कैसा महसूस कर रहे हैं — कोई जल्दी नहीं। हाल ही में आप कैसा महसूस कर रहे हैं?",
  ta: "வணக்கம். நான் மன்-மித்ரா — நீங்கள் எப்படி இருக்கிறீர்கள் என்று அறிய இங்கே இருக்கிறேன். சமீபத்தில் நீங்கள் எப்படி உணர்கிறீர்கள்?",
};

export default function VictimCheckinPage() {
  const [profile, setProfile] = useState<{ full_name: string; preferred_language: string } | null>(null);
  const [caseRow, setCaseRow] = useState<Case | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [chatError, setChatError] = useState("");
  const [locale, setLocale] = useState<Locale>("en");
  const [token, setToken] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const t = getMessages(locale);

  useEffect(() => {
    async function init() {
      setLoadError("");
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      if (prof) {
        setProfile(prof);
        const lang = (prof.preferred_language as Locale) || "en";
        setLocale(lang);
        setMessages([{ role: "assistant", content: GREETINGS[lang] ?? GREETINGS.en }]);
      }

      try {
        const cases = await apiFetch<CaseWithDetails[]>("/cases", {
          token: session.access_token,
        });
        if (cases?.[0]) {
          setCaseRow(cases[0]);
        } else {
          setLoadError(
            "No case linked to your account. Use a seeded demo account (victim1@samvedna.demo) or ask your counsellor to assign one."
          );
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Could not load your case");
      }
    }
    init();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function getBotReply(userMsg: string, history: ChatMessage[]) {
    setChatError("");
    try {
      const data = await apiFetch<{ response: string }>("/chat", {
        method: "POST",
        token,
        body: JSON.stringify({
          message: userMsg,
          preferred_language: locale,
          conversation_history: history
            .filter((m) => m.role === "user" || (m.role === "assistant" && history.indexOf(m) > 0))
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      return data.response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Chat unavailable";
      setChatError(msg);
      return locale === "hi"
        ? "मैं अभी पूरी तरह जुड़ नहीं पा रहा, लेकिन मैं सुन रहा हूँ। आप जो भी साझा करना चाहें, यहाँ लिख सकते हैं।"
        : locale === "ta"
          ? "நான் இப்போது முழுவதும் இணைக்க முடியவில்லை, ஆனால் கேட்கிறேன். நீங்கள் பகிர விரும்புவதை இங்கே எழுதலாம்."
          : "I'm having trouble connecting right now, but I'm listening. Please share what's on your mind — your words will still be saved.";
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !caseRow || !token) return;

    const userMsg = input.trim();
    setInput("");
    const newHistory = [...messages, { role: "user" as const, content: userMsg }];
    setMessages(newHistory);
    setLoading(true);

    try {
      const botReply = await getBotReply(userMsg, newHistory);
      setMessages((prev) => [...prev, { role: "assistant", content: botReply }]);
    } finally {
      setLoading(false);
    }
  }

  async function finishCheckin() {
    if (!caseRow || !token) return;
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 0) return;

    setSubmitting(true);
    setChatError("");
    try {
      const transcript = userMessages.map((m) => m.content).join("\n");
      await apiFetch<CreateCheckinResponse>("/checkins", {
        method: "POST",
        token,
        body: JSON.stringify({ case_id: caseRow.id, message: transcript, channel: "chat" }),
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            locale === "hi"
              ? "आपकी जांच सहेज ली गई है। धन्यवाद। जब भी तैयार हों, मैं यहाँ हूँ।"
              : locale === "ta"
                ? "உங்கள் சரிபார்ப்பு சேமிக்கப்பட்டது. நன்றி."
                : "Your check-in has been saved. Thank you — I'm here whenever you need.",
        },
      ]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to save check-in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell userName={profile?.full_name}>
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t.checkinTitle}</h1>
            <p className="text-muted-foreground">{t.checkinSubtitle}</p>
          </div>
          <select
            className="rounded-md border px-2 py-1 text-sm"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="en">English</option>
            <option value="hi">हिंदी</option>
            <option value="ta">தமிழ்</option>
          </select>
        </div>

        <CrisisNotice locale={locale} />

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Phone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="text-sm">
                <p className="font-medium">Prefer to talk instead of type?</p>
                <p className="text-muted-foreground">
                  Voice check-ins route to your counsellor or AI based on your distress level.
                </p>
              </div>
            </div>
            <Link href="/victim/call">
              <Button variant="secondary" size="sm" className="shrink-0">
                Start voice call
              </Button>
            </Link>
          </CardContent>
        </Card>

        {caseRow && (
          <p className="text-xs text-muted-foreground">
            Case {caseRow.case_number} · {caseRow.case_type}
          </p>
        )}

        {loadError && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Cannot start check-in yet</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        )}

        <div className="flex h-[28rem] flex-col rounded-xl border bg-card shadow-sm">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-secondary text-secondary-foreground rounded-bl-md"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-secondary px-4 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSend} className="flex gap-2 border-t p-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={caseRow ? t.typeMessage : "Assign a case first to chat..."}
              disabled={!caseRow || loading || !token}
              className="flex-1 border-0 bg-muted/50 focus-visible:ring-1"
            />
            <Button type="submit" size="icon" disabled={!input.trim() || !caseRow || loading}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>

        {chatError && (
          <p className="text-center text-xs text-destructive">{chatError}</p>
        )}

        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={finishCheckin}
            disabled={submitting || !caseRow || messages.filter((m) => m.role === "user").length === 0}
          >
            {submitting ? "Saving..." : "I'm done for now — save check-in"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
