"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Mic, PhoneOff, Volume2, Loader2 } from "lucide-react";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface AiVoiceCallProps {
  token: string;
  locale: string;
  sessionId: string;
  onComplete: (transcript: string, durationSeconds: number) => void;
  onCancel: () => void;
  /** When false, parent owns persistence/scoring (e.g. instant_calls flow). Default true. */
  persistViaCallsApi?: boolean;
}

function recognitionLang(locale: string) {
  if (locale === "hi") return "hi-IN";
  if (locale === "ta") return "ta-IN";
  return "en-IN";
}

export function AiVoiceCall({
  token,
  locale,
  sessionId,
  onComplete,
  onCancel,
  persistViaCallsApi = true,
}: AiVoiceCallProps) {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState("Tap Start to begin your AI wellness call");
  const [micError, setMicError] = useState("");

  const startedAt = useRef(0);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const wantListenRef = useRef(false);
  const processingRef = useRef(false);
  const endedRef = useRef(false);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalChunkRef = useRef("");

  const clearCommitTimer = () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  };

  const stopRecognition = useCallback(() => {
    wantListenRef.current = false;
    clearCommitTimer();
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) {
      setListening(false);
      return;
    }
    try {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.stop();
    } catch {
      /* already stopped */
    }
    setListening(false);
  }, []);

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      // Always mute recognition while TTS plays (prevents echo / self-hearing).
      wantListenRef.current = false;
      clearCommitTimer();
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      setListening(false);

      if (!window.speechSynthesis) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = recognitionLang(locale);
      utter.rate = 0.92;
      setSpeaking(true);
      utter.onend = () => {
        setSpeaking(false);
        resolve();
      };
      utter.onerror = () => {
        setSpeaking(false);
        resolve();
      };
      window.speechSynthesis.speak(utter);
    });
  }, [locale]);

  const getBotReply = useCallback(
    async (message: string, history: Turn[]) => {
      const data = await apiFetch<{ response: string }>("/chat", {
        method: "POST",
        token,
        body: JSON.stringify({
          message,
          preferred_language: locale,
          conversation_history: history.map((t) => ({
            role: t.role === "assistant" ? "assistant" : "user",
            content: t.content,
          })),
        }),
      });
      return data.response;
    },
    [token, locale]
  );

  const beginListeningRef = useRef<() => void>(() => {});

  const handleUtterance = useCallback(
    async (transcript: string) => {
      const cleaned = transcript.trim();
      if (!cleaned || processingRef.current || endedRef.current) return;

      processingRef.current = true;
      wantListenRef.current = false;
      clearCommitTimer();
      finalChunkRef.current = "";
      setBusy(true);
      setStatus(`You said: "${cleaned}"`);

      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }

      const userTurn: Turn = { role: "user", content: cleaned };
      const newTurns = [...turnsRef.current, userTurn];
      turnsRef.current = newTurns;
      setTurns(newTurns);

      try {
        const reply = await getBotReply(cleaned, newTurns);
        const botTurn: Turn = { role: "assistant", content: reply };
        turnsRef.current = [...newTurns, botTurn];
        setTurns(turnsRef.current);
        await speak(reply);
        if (!endedRef.current) {
          setStatus("Listening… speak when ready");
          processingRef.current = false;
          setBusy(false);
          beginListeningRef.current();
        }
      } catch {
        setStatus("Connection issue — tap Speak to try again");
        processingRef.current = false;
        setBusy(false);
      }
    },
    [getBotReply, speak]
  );

  const beginListening = useCallback(() => {
    if (endedRef.current || processingRef.current) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus("Speech recognition not supported. Use Chrome.");
      setMicError("Web Speech API unavailable");
      return;
    }

    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }

    const recognition = new SR();
    recognition.lang = recognitionLang(locale);
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    wantListenRef.current = true;
    finalChunkRef.current = "";

    recognition.onstart = () => {
      setListening(true);
      setMicError("");
      setStatus("Listening… speak clearly into your mic");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalChunkRef.current += `${text} `;
          clearCommitTimer();
          // Short pause after final phrase → commit utterance
          commitTimerRef.current = setTimeout(() => {
            const pending = finalChunkRef.current.trim();
            if (pending.length > 1) {
              finalChunkRef.current = "";
              void handleUtterance(pending);
            }
          }, 850);
        } else {
          interim += text;
        }
      }
      if (interim) setStatus(`Hearing: ${interim}`);
    };

    recognition.onerror = (event: Event) => {
      const err = (event as SpeechRecognitionErrorEvent).error;
      setListening(false);
      if (err === "aborted") return;
      if (err === "no-speech") {
        // Chrome fires this when continuous session idles — keep listening.
        return;
      }
      if (err === "not-allowed" || err === "service-not-allowed") {
        wantListenRef.current = false;
        setMicError("Microphone permission blocked. Allow mic for this site in Chrome.");
        setStatus("Allow microphone access, then tap Speak");
        return;
      }
      if (err === "network") {
        setStatus("Speech network error — tap Speak to retry");
        return;
      }
      setStatus(`Couldn't hear you — tap Speak (${err})`);
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (wantListenRef.current && !processingRef.current && !endedRef.current) {
        window.setTimeout(() => {
          if (wantListenRef.current && !endedRef.current && !processingRef.current) {
            beginListeningRef.current();
          }
        }, 350);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch {
          setStatus("Mic busy — tap Speak to retry");
        }
      }, 300);
    }
  }, [locale, handleUtterance]);

  beginListeningRef.current = beginListening;

  async function ensureMicPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicError("");
      return true;
    } catch {
      setMicError("Microphone permission blocked. Click the lock icon in the address bar → allow mic.");
      setStatus("Allow microphone access, then tap Start again");
      return false;
    }
  }

  async function handleStart() {
    endedRef.current = false;
    processingRef.current = false;
    const ok = await ensureMicPermission();
    if (!ok) return;

    startedAt.current = Date.now();
    setActive(true);
    try {
      await apiFetch(`/calls/${sessionId}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status: "in_progress" }),
      });
    } catch {
      /* best-effort for instant_calls */
    }

    const greeting =
      locale === "hi"
        ? "नमस्ते। मैं मन-मित्र हूँ। आज आप कैसा महसूस कर रहे हैं?"
        : locale === "ta"
          ? "வணக்கம். நான் மன்-மித்ரா. இன்று நீங்கள் எப்படி உணர்கிறீர்கள்?"
          : "Hello. I'm Mann-Mitra. How are you feeling today?";

    const botTurn: Turn = { role: "assistant", content: greeting };
    turnsRef.current = [botTurn];
    setTurns([botTurn]);
    await speak(greeting);
    setStatus("Listening… speak when ready");
    beginListening();
  }

  async function resumeListen() {
    if (speaking || busy || processingRef.current) return;
    const ok = await ensureMicPermission();
    if (!ok) return;
    processingRef.current = false;
    setStatus("Listening… speak when ready");
    beginListening();
  }

  async function handleEnd() {
    endedRef.current = true;
    wantListenRef.current = false;
    window.speechSynthesis?.cancel();
    stopRecognition();
    const duration = Math.max(1, Math.floor((Date.now() - startedAt.current) / 1000));
    const transcript = turnsRef.current
      .filter((t) => t.role === "user")
      .map((t) => t.content)
      .join("\n");

    if (persistViaCallsApi) {
      try {
        await apiFetch(`/calls/${sessionId}/complete`, {
          method: "POST",
          token,
          body: JSON.stringify({ transcript, duration_seconds: duration }),
        });
      } catch {
        /* parent may still save */
      }
    }

    onComplete(transcript, duration);
  }

  useEffect(() => {
    return () => {
      endedRef.current = true;
      wantListenRef.current = false;
      clearCommitTimer();
      window.speechSynthesis?.cancel();
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-6 rounded-xl border bg-card p-8">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
        {speaking ? (
          <Volume2 className="h-10 w-10 animate-pulse text-primary" />
        ) : busy ? (
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        ) : listening ? (
          <Mic className="h-10 w-10 animate-pulse text-primary" />
        ) : (
          <Mic className="h-10 w-10 text-primary/50" />
        )}
      </div>

      <p className="text-center text-sm text-muted-foreground">{status}</p>
      {micError && (
        <p className="text-center text-sm text-destructive" role="alert">
          {micError}
        </p>
      )}

      {turns.length > 0 && (
        <div className="max-h-40 w-full overflow-y-auto rounded border bg-muted/30 p-3 text-xs leading-relaxed">
          {turns.map((t, i) => (
            <p key={i} className={t.role === "user" ? "text-primary" : ""}>
              <strong>{t.role === "user" ? "You" : "Mann-Mitra"}:</strong> {t.content}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {!active ? (
          <>
            <Button onClick={() => void handleStart()} size="lg">
              Start AI call
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="lg"
              variant={listening ? "secondary" : "default"}
              onClick={() => void resumeListen()}
              disabled={speaking || busy}
            >
              <Mic className="mr-2 h-4 w-4" />
              {listening ? "Listening…" : "Speak"}
            </Button>
            <Button size="lg" variant="destructive" onClick={() => void handleEnd()}>
              <PhoneOff className="mr-2 h-4 w-4" />
              End call
            </Button>
          </>
        )}
      </div>

      <p className="max-w-sm text-center text-xs text-muted-foreground">
        Uses your browser mic. Pause briefly after speaking so Mann-Mitra can reply. Prefer Chrome;
        allow microphone when prompted.
      </p>
    </div>
  );
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: { transcript: string };
  isFinal: boolean;
  length: number;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}
