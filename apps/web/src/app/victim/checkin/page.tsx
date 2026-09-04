"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { MeshGradient } from "@/components/mesh-gradient";
import { BreathingOrb } from "@/components/breathing-orb";
import { CrisisSheet } from "@/components/crisis-sheet";
import { apiFetch } from "@/lib/utils";
import { getMessages, type Locale } from "@/i18n/messages";
import type { Case, CaseWithDetails, CreateCheckinResponse } from "@samvedna/shared-types";

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

const GREETINGS: Record<string, string> = {
  en: "How has today been? There is no rush — share only what feels safe.",
  hi: "आज कैसा रहा? कोई जल्दी नहीं — जितना सुरक्षित लगे, उतना ही बताएँ।",
  ta: "இன்று எப்படி இருந்தது? அவசரமில்லை — பாதுகாப்பாக உணரும் அளவுக்கு மட்டும் பகிரவும்.",
};

const LANGS: Array<{ code: Locale | string; label: string }> = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "ta", label: "தமிழ்" },
  { code: "te", label: "తెలుగు" },
  { code: "mr", label: "मराठी" },
  { code: "bn", label: "বাংলা" },
  { code: "kn", label: "ಕನ್ನಡ" },
  { code: "gu", label: "ગુજરાતી" },
  { code: "or", label: "ଓଡ଼ିଆ" },
  { code: "pa", label: "ਪੰਜਾਬੀ" },
  { code: "ml", label: "മലയാളം" },
  { code: "as", label: "অসমীয়া" },
];

function StreamingText({ text }: { text: string }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(text);
      return;
    }
    setShown("");
    const charsPerTick = Math.max(1, Math.ceil(text.length / (text.length / 4 + 8)));
    let i = 0;
    const id = window.setInterval(() => {
      i = Math.min(text.length, i + charsPerTick);
      setShown(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, 40);
    return () => window.clearInterval(id);
  }, [text]);
  return <>{shown}</>;
}

export default function VictimCheckinPage() {
  const [profile, setProfile] = useState<{ full_name: string; preferred_language: string } | null>(
    null
  );
  const [caseRow, setCaseRow] = useState<Case | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [started, setStarted] = useState(false);
  const [input, setInput] = useState("");
  const [mood, setMood] = useState(50);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);

      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();
      if (prof) {
        setProfile(prof);
        const lang = (prof.preferred_language as Locale) || "en";
        setLocale(lang);
      }

      try {
        const cases = await apiFetch<CaseWithDetails[]>("/cases", {
          token: session.access_token,
        });
        if (cases?.[0]) setCaseRow(cases[0]);
        else {
          setLoadError(
            "No case linked yet. Use a seeded demo account or ask your counsellor to assign one."
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
  }, [messages, loading]);

  function begin() {
    setStarted(true);
    setMessages([{ role: "assistant", content: GREETINGS[locale] ?? GREETINGS.en }]);
  }

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
    } catch {
      setChatError("Chat is temporarily unavailable — your words can still be saved.");
      return locale === "hi"
        ? "मैं सुन रहा हूँ। आप जो भी साझा करना चाहें, यहाँ लिख सकते हैं।"
        : "I'm listening. Share whatever feels right — it will still be kept safely.";
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
      const transcript = [
        ...userMessages.map((m) => m.content),
        `[mood_temperature:${mood}]`,
      ].join("\n");
      await apiFetch<CreateCheckinResponse>("/checkins", {
        method: "POST",
        token,
        body: JSON.stringify({ case_id: caseRow.id, message: transcript, channel: "chatbot" }),
      });
      setDone(true);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to save check-in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="theme-sanctuary relative min-h-screen overflow-x-hidden">
      <MeshGradient />
      <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.3em] text-[var(--sanctuary-ink-3)]">SAMVEDNA</p>
            <p className="text-sm text-[var(--sanctuary-ink-2)]">
              {profile?.full_name ? `Hello, ${profile.full_name.split(" ")[0]}` : t.checkinTitle}
            </p>
          </div>
          <CrisisSheet locale={locale} />
        </header>

        <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLocale(l.code as Locale)}
              className={`text-sm transition ${
                locale === l.code
                  ? "text-[var(--sanctuary-ink)] underline underline-offset-4"
                  : "text-[var(--sanctuary-ink-3)]"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        {loadError && (
          <p className="mt-8 text-sm text-[var(--sanctuary-terracotta)]" role="alert">
            {loadError}
          </p>
        )}

        {!started && !done && (
          <div className="flex flex-1 flex-col items-center justify-center py-16">
            <p className="mb-10 text-center font-display text-3xl text-[var(--sanctuary-ink)] sm:text-4xl">
              How has today been?
            </p>
            <BreathingOrb onActivate={begin} />
            <p className="mt-10 max-w-sm text-center text-sm text-[var(--sanctuary-ink-2)]">
              Or type below whenever you are ready. Nothing here shows a score or a risk label —
              by design.
            </p>
            <Link
              href="/victim/call"
              className="mt-8 text-sm text-[var(--sanctuary-teal)] underline underline-offset-4"
            >
              Prefer to talk instead →
            </Link>
          </div>
        )}

        {started && !done && (
          <>
            <div
              className="mt-10 flex-1 space-y-8"
              aria-live="polite"
              aria-relevant="additions"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={m.role === "user" ? "text-right" : "text-left"}
                >
                  {m.role === "user" ? (
                    <p className="font-display text-[19px] italic text-[var(--sanctuary-ink)]">
                      {m.content}
                    </p>
                  ) : (
                    <p className="max-w-prose text-[17px] leading-relaxed text-[var(--sanctuary-ink-2)]">
                      {i === messages.length - 1 && !loading ? (
                        <StreamingText text={m.content} />
                      ) : (
                        m.content
                      )}
                    </p>
                  )}
                </div>
              ))}
              {loading && (
                <p className="text-sm text-[var(--sanctuary-ink-3)]">Mann-Mitra is listening…</p>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="mt-10">
              <div className="mb-2 flex justify-between text-xs text-[var(--sanctuary-ink-3)]">
                <span>heavy</span>
                <span>lighter</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={mood}
                onChange={(e) => setMood(Number(e.target.value))}
                aria-label="How heavy or light today feels"
                className="h-2 w-full cursor-pointer appearance-none rounded-none"
                style={{
                  background:
                    "linear-gradient(90deg, #6b9080 0%, #e8dcc8 50%, #c97b5a 100%)",
                }}
              />
            </div>

            <form onSubmit={handleSend} className="mt-8 flex gap-3 border-b border-[var(--sanctuary-sand)] pb-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={caseRow ? "Write freely…" : "Assign a case first…"}
                disabled={!caseRow || loading || !token}
                className="flex-1 border-0 bg-transparent text-[17px] text-[var(--sanctuary-ink)] outline-none placeholder:text-[var(--sanctuary-ink-3)]"
              />
              <button
                type="submit"
                disabled={!input.trim() || !caseRow || loading}
                className="text-sm text-[var(--sanctuary-teal)] disabled:opacity-40"
              >
                Send
              </button>
            </form>

            {chatError && (
              <p className="mt-3 text-center text-xs text-[var(--sanctuary-terracotta)]">{chatError}</p>
            )}

            <button
              type="button"
              onClick={finishCheckin}
              disabled={
                submitting || !caseRow || messages.filter((m) => m.role === "user").length === 0
              }
              className="mt-8 self-center text-sm text-[var(--sanctuary-ink-2)] underline underline-offset-4 disabled:opacity-40"
            >
              {submitting ? "Saving…" : "I'm done for now"}
            </button>
          </>
        )}

        {done && (
          <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
            <p className="font-display text-3xl text-[var(--sanctuary-ink)] sm:text-4xl">
              Thank you for telling me.
            </p>
            <p className="mt-4 max-w-md text-[var(--sanctuary-ink-2)]">
              Someone who cares is looking at your case. Your counsellor has been notified when
              needed — you will not see a score here, ever.
            </p>
            <Link
              href="/victim/history"
              className="mt-10 text-sm text-[var(--sanctuary-teal)] underline underline-offset-4"
            >
              See your care journey →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
