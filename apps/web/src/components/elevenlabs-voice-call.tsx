"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_AGENT_ID =
  process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "agent_2101m1ng9ejnef2b32zenky85t3z";

export type VoiceEmotionHint =
  | "anxious"
  | "sad"
  | "angry"
  | "fearful"
  | "calm"
  | "distressed"
  | "hopeful"
  | "neutral";

type Turn = { role: "user" | "agent"; content: string; at: number };

export type ElevenLabsCallCompletePayload = {
  transcript: string;
  duration_seconds: number;
  conversation_id: string | null;
  emotion_hints: VoiceEmotionHint[];
  keywords: string[];
};

type Props = {
  agentId?: string;
  locale?: string;
  onComplete: (payload: ElevenLabsCallCompletePayload) => void;
  onCancel: () => void;
};

function inferEmotionsFromText(text: string): VoiceEmotionHint[] {
  const out = new Set<VoiceEmotionHint>();
  const t = text.toLowerCase();
  if (/\b(anxious|anxiety|panic|worried|nervous|scared|afraid|fear)\b|चिंता|डर|घबरा/.test(t)) {
    out.add("anxious");
    out.add("fearful");
  }
  if (/\b(sad|hopeless|empty|cry|crying|depress|lonely)\b|उदास|निराश|अकेला/.test(t)) {
    out.add("sad");
  }
  if (/\b(angry|anger|rage|furious|hate)\b|गुस्सा/.test(t)) out.add("angry");
  if (/\b(help|hurt|unsafe|threat|harass|can't|cannot)\b|मदद|खतरा/.test(t)) {
    out.add("distressed");
  }
  if (/\b(ok|okay|better|hope|grateful|thank)\b|ठीक|आशा/.test(t)) out.add("hopeful");
  if (out.size === 0 && text.trim()) out.add("neutral");
  return [...out];
}

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4);
  const stop = new Set([
    "about",
    "there",
    "their",
    "would",
    "could",
    "should",
    "which",
    "where",
    "being",
    "going",
    "really",
    "something",
    "anything",
    "please",
    "thank",
    "thanks",
  ]);
  const counts = new Map<string, number>();
  for (const w of words) {
    if (stop.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
}

function CallSession({ agentId, locale, onComplete, onCancel }: Props & { agentId: string }) {
  const [phase, setPhase] = useState<"idle" | "connecting" | "live" | "ending">("idle");
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [muted, setMuted] = useState(false);
  const startedAt = useRef<number>(0);
  const turnsRef = useRef<Turn[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const completedRef = useRef(false);

  const finish = useCallback(
    (cancelled: boolean) => {
      if (completedRef.current) return;
      completedRef.current = true;
      const duration = Math.max(1, Math.round((Date.now() - (startedAt.current || Date.now())) / 1000));
      const lines = turnsRef.current.map((t) =>
        `${t.role === "user" ? "Survivor" : "Mann-Mitra"}: ${t.content}`
      );
      const transcript = lines.join("\n").trim();
      const userText = turnsRef.current
        .filter((t) => t.role === "user")
        .map((t) => t.content)
        .join(" ");

      if (cancelled && !transcript) {
        onCancel();
        return;
      }

      onComplete({
        transcript:
          transcript ||
          (cancelled
            ? ""
            : "Short voice check-in with Mann-Mitra (no transcript captured)."),
        duration_seconds: duration,
        conversation_id: conversationIdRef.current,
        emotion_hints: inferEmotionsFromText(userText),
        keywords: extractKeywords(userText),
      });
    },
    [onCancel, onComplete]
  );

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      conversationIdRef.current = conversationId;
      setPhase("live");
      setError("");
    },
    onDisconnect: () => {
      setPhase("ending");
      finish(false);
    },
    onError: (message) => {
      setError(typeof message === "string" ? message : "Voice connection issue");
      setPhase("idle");
    },
    onMessage: ({ message, role }) => {
      if (!message?.trim()) return;
      const turn: Turn = {
        role: role === "user" ? "user" : "agent",
        content: message.trim(),
        at: Date.now(),
      };
      turnsRef.current = [...turnsRef.current, turn];
      setTurns(turnsRef.current);
    },
  });

  const start = useCallback(async () => {
    setError("");
    setPhase("connecting");
    startedAt.current = Date.now();
    completedRef.current = false;
    turnsRef.current = [];
    setTurns([]);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      conversation.startSession({
        agentId,
        connectionType: "webrtc",
      });
    } catch (err) {
      setPhase("idle");
      setError(
        err instanceof Error
          ? err.message
          : "Microphone permission is required for the voice call"
      );
    }
  }, [agentId, conversation]);

  useEffect(() => {
    // Auto-start when the call sheet opens
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    // setMuted throws if called before startSession() completes
    if (phase !== "live") return;
    try {
      conversation.setMuted(muted);
    } catch {
      /* session not ready yet */
    }
  }, [muted, conversation, phase]);

  async function hangUp() {
    setPhase("ending");
    try {
      conversation.endSession();
    } catch {
      /* ignore */
    }
    // endSession may not always fire onDisconnect promptly
    setTimeout(() => finish(false), 400);
  }

  const listening = conversation.isListening;
  const speaking = conversation.isSpeaking;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-between gap-6 px-4 py-8">
      <div className="w-full space-y-2 text-center">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Instant voice · ElevenLabs
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Mann-Mitra
        </h1>
        <p className="text-sm text-muted-foreground">
          {phase === "connecting" && "Connecting secure voice…"}
          {phase === "live" &&
            (speaking ? "Mann-Mitra is speaking…" : listening ? "Listening — speak freely" : "On the line")}
          {phase === "ending" && "Saving your check-in…"}
          {phase === "idle" && (error || "Tap connect to begin")}
        </p>
        {locale && locale !== "en" && (
          <p className="text-xs text-muted-foreground">Preferred language: {locale}</p>
        )}
      </div>

      <div className="relative flex h-44 w-44 items-center justify-center">
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full transition-all duration-700",
            speaking || listening ? "scale-110 opacity-100" : "scale-100 opacity-70"
          )}
          style={{
            background:
              "radial-gradient(circle at 40% 35%, rgba(15,111,101,0.45), rgba(15,111,101,0.1) 55%, transparent 72%)",
            animation: phase === "live" ? "pulse 2.4s ease-in-out infinite" : undefined,
          }}
        />
        <div className="relative z-10 flex h-28 w-28 items-center justify-center rounded-full border border-primary/30 bg-background/80 shadow-sm backdrop-blur">
          {phase === "connecting" || phase === "ending" ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : speaking ? (
            <span className="text-sm font-medium text-primary">Speaking</span>
          ) : (
            <Mic className={cn("h-8 w-8", listening ? "text-primary" : "text-muted-foreground")} />
          )}
        </div>
      </div>

      <div className="max-h-40 w-full overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-3 text-left text-xs leading-relaxed text-muted-foreground">
        {turns.length === 0 ? (
          <p>Your conversation will appear here as you speak.</p>
        ) : (
          <ul className="space-y-2">
            {turns.slice(-8).map((t, i) => (
              <li key={`${t.at}-${i}`}>
                <span className="font-medium text-foreground">
                  {t.role === "user" ? "You" : "Agent"}:{" "}
                </span>
                {t.content}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-center text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex w-full flex-wrap items-center justify-center gap-3">
        {phase === "idle" && (
          <Button size="lg" onClick={() => void start()}>
            <Mic className="mr-2 h-4 w-4" />
            Connect voice
          </Button>
        )}
        {phase === "live" && (
          <>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setMuted((m) => !m)}
              aria-pressed={muted}
            >
              {muted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
              {muted ? "Unmute" : "Mute"}
            </Button>
            <Button size="lg" variant="destructive" onClick={() => void hangUp()}>
              <PhoneOff className="mr-2 h-4 w-4" />
              End call
            </Button>
          </>
        )}
        {(phase === "idle" || phase === "connecting") && (
          <Button
            variant="ghost"
            onClick={() => {
              try {
                conversation.endSession();
              } catch {
                /* ignore */
              }
              onCancel();
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * ElevenLabs Conversational AI voice call sheet.
 * Opens a live voice interface; on hang-up returns transcript + emotion/keyword hints for scoring.
 */
export function ElevenLabsVoiceCall(props: Props) {
  const agentId = props.agentId || DEFAULT_AGENT_ID;
  return (
    <ConversationProvider>
      <CallSession {...props} agentId={agentId} />
    </ConversationProvider>
  );
}
