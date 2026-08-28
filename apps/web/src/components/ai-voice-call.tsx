"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";

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
}

export function AiVoiceCall({ token, locale, sessionId, onComplete, onCancel }: AiVoiceCallProps) {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState("Tap Start to begin your AI wellness call");
  const startedAt = useRef<number>(0);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const turnsRef = useRef<Turn[]>([]);

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (!window.speechSynthesis) {
          resolve();
          return;
        }
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = locale === "hi" ? "hi-IN" : locale === "ta" ? "ta-IN" : "en-IN";
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
      }),
    [locale]
  );

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

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus("Speech recognition not supported in this browser. Use Chrome.");
      return;
    }

    const recognition = new SR();
    recognition.lang = locale === "hi" ? "hi-IN" : locale === "ta" ? "ta-IN" : "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setStatus("Listening… speak now");
    };

    recognition.onend = () => setListening(false);

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setStatus(`You said: "${transcript}"`);

      const userTurn: Turn = { role: "user", content: transcript };
      const newTurns = [...turnsRef.current, userTurn];
      turnsRef.current = newTurns;
      setTurns(newTurns);

      try {
        const reply = await getBotReply(transcript, newTurns);
        const botTurn: Turn = { role: "assistant", content: reply };
        turnsRef.current = [...newTurns, botTurn];
        setTurns(turnsRef.current);
        await speak(reply);
        setStatus("Tap the microphone when you're ready to speak again");
      } catch {
        setStatus("Connection issue — tap mic to try again");
      }
    };

    recognition.onerror = () => {
      setListening(false);
      setStatus("Couldn't hear you — tap mic to try again");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [locale, getBotReply, speak]);

  async function handleStart() {
    startedAt.current = Date.now();
    setActive(true);
    await apiFetch(`/calls/${sessionId}/status`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status: "in_progress" }),
    });

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
    setStatus("Tap the microphone when you're ready to speak");
  }

  async function handleEnd() {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    const duration = Math.floor((Date.now() - startedAt.current) / 1000);
    const transcript = turnsRef.current
      .filter((t) => t.role === "user")
      .map((t) => t.content)
      .join("\n");

    await apiFetch(`/calls/${sessionId}/complete`, {
      method: "POST",
      token,
      body: JSON.stringify({ transcript, duration_seconds: duration }),
    });

    onComplete(transcript, duration);
  }

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      recognitionRef.current?.stop();
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border bg-card p-8">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
        {speaking ? (
          <Volume2 className="h-10 w-10 animate-pulse text-primary" />
        ) : listening ? (
          <Mic className="h-10 w-10 animate-pulse text-primary" />
        ) : (
          <Mic className="h-10 w-10 text-primary" />
        )}
      </div>

      <p className="text-center text-sm text-muted-foreground">{status}</p>

      {turns.length > 0 && (
        <div className="max-h-32 w-full overflow-y-auto rounded border bg-muted/30 p-3 text-xs">
          {turns.map((t, i) => (
            <p key={i} className={t.role === "user" ? "text-primary" : ""}>
              <strong>{t.role === "user" ? "You" : "Mann-Mitra"}:</strong> {t.content}
            </p>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        {!active ? (
          <>
            <Button onClick={handleStart} size="lg">
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
              onClick={startListening}
              disabled={speaking}
            >
              {listening ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
              {listening ? "Listening…" : "Speak"}
            </Button>
            <Button size="lg" variant="destructive" onClick={handleEnd}>
              <PhoneOff className="mr-2 h-4 w-4" />
              End call
            </Button>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        AI voice uses your browser microphone &amp; speakers. Use Chrome for best results.
      </p>
    </div>
  );
}

// Web Speech API types
interface SpeechRecognition extends EventTarget {
  lang: string;
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
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: { transcript: string };
  length: number;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}
