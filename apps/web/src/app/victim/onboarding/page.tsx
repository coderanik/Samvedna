"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { apiFetch } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SamvednaMark } from "@/components/samvedna-logo";
import { homeForRole } from "@/lib/auth";

type Question = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "text";
  options?: Array<{ value: string; label: string }>;
};

type StatusPayload = {
  completed: boolean;
  preferred_language?: string;
  full_name?: string | null;
  questions: Question[];
};

const STEP_KEYS = [
  "mood",
  "sleep",
  "safety",
  "energy",
  "crisis",
  "support_needs",
  "preferred_language",
  "notes",
] as const;

export default function VictimOnboardingPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");

  const [mood, setMood] = useState("");
  const [sleep, setSleep] = useState("");
  const [safety, setSafety] = useState("");
  const [energy, setEnergy] = useState("");
  const [crisis, setCrisis] = useState("");
  const [supportNeeds, setSupportNeeds] = useState<string[]>(["counselling"]);
  const [language, setLanguage] = useState("en");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setToken(session.access_token);
      try {
        const status = await apiFetch<StatusPayload>("/victim/onboarding/status", {
          token: session.access_token,
        });
        if (status.completed) {
          router.replace(homeForRole("victim"));
          return;
        }
        setQuestions(status.questions ?? []);
        if (status.preferred_language) setLanguage(status.preferred_language);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load onboarding");
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [router]);

  const byId = useMemo(() => {
    const map = new Map(questions.map((q) => [q.id, q]));
    return map;
  }, [questions]);

  const currentKey = STEP_KEYS[step];
  const current = byId.get(currentKey) ?? {
    id: currentKey,
    prompt: currentKey,
    type: currentKey === "notes" ? ("text" as const) : currentKey === "support_needs" ? ("multi" as const) : ("single" as const),
  };

  function currentValueSet(): boolean {
    switch (currentKey) {
      case "mood":
        return Boolean(mood);
      case "sleep":
        return Boolean(sleep);
      case "safety":
        return Boolean(safety);
      case "energy":
        return Boolean(energy);
      case "crisis":
        return Boolean(crisis);
      case "support_needs":
        return supportNeeds.length > 0;
      case "preferred_language":
        return Boolean(language);
      case "notes":
        return true;
      default:
        return false;
    }
  }

  function toggleNeed(value: string) {
    setSupportNeeds((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  async function submit() {
    if (!token) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await apiFetch<{
        message: string;
        consultant: { name: string } | null;
      }>("/victim/onboarding/complete", {
        method: "POST",
        token,
        body: JSON.stringify({
          mood,
          sleep,
          safety,
          energy,
          crisis,
          support_needs: supportNeeds,
          preferred_language: language,
          notes,
        }),
      });
      setDoneMessage(
        result.message ||
          (result.consultant
            ? `${result.consultant.name} has been allotted to you.`
            : "Onboarding complete.")
      );
      setTimeout(() => router.replace(homeForRole("victim")), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save onboarding");
      setSubmitting(false);
    }
  }

  function next() {
    if (!currentValueSet()) {
      setError("Please choose an option to continue.");
      return;
    }
    setError("");
    if (step >= STEP_KEYS.length - 1) {
      void submit();
      return;
    }
    setStep((s) => s + 1);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/5">
        <p className="text-sm text-muted-foreground">Preparing your welcome…</p>
      </div>
    );
  }

  if (doneMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/5 p-4">
        <div className="max-w-md text-center">
          <SamvednaMark size={48} animated className="mx-auto mb-4" />
          <h1 className="font-display text-2xl font-semibold">You&apos;re set</h1>
          <p className="mt-2 text-sm text-muted-foreground">{doneMessage}</p>
          <p className="mt-4 text-xs text-muted-foreground">Taking you to your home…</p>
        </div>
      </div>
    );
  }

  const progress = ((step + 1) / STEP_KEYS.length) * 100;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/5 p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <SamvednaMark size={40} animated />
          <div>
            <p className="font-display text-xl font-semibold tracking-tight">Samvedna</p>
            <p className="text-xs text-muted-foreground">A few questions so we can support you well</p>
          </div>
        </div>

        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Step {step + 1} of {STEP_KEYS.length}
        </p>

        <div className="rounded-2xl border bg-card/80 p-5 shadow-sm backdrop-blur sm:p-6">
          <h1 className="font-display text-xl font-semibold sm:text-2xl">{current.prompt}</h1>

          <div className="mt-5 space-y-2">
            {current.type === "text" ? (
              <textarea
                className="min-h-[120px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Share anything that feels important…"
                maxLength={2000}
              />
            ) : current.type === "multi" ? (
              (current.options ?? []).map((opt) => {
                const selected = supportNeeds.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleNeed(opt.value)}
                    className={`flex w-full items-center rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })
            ) : (
              (current.options ?? []).map((opt) => {
                const selected =
                  (currentKey === "mood" && mood === opt.value) ||
                  (currentKey === "sleep" && sleep === opt.value) ||
                  (currentKey === "safety" && safety === opt.value) ||
                  (currentKey === "energy" && energy === opt.value) ||
                  (currentKey === "crisis" && crisis === opt.value) ||
                  (currentKey === "preferred_language" && language === opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      if (currentKey === "mood") setMood(opt.value);
                      if (currentKey === "sleep") setSleep(opt.value);
                      if (currentKey === "safety") setSafety(opt.value);
                      if (currentKey === "energy") setEnergy(opt.value);
                      if (currentKey === "crisis") setCrisis(opt.value);
                      if (currentKey === "preferred_language") setLanguage(opt.value);
                    }}
                    className={`flex w-full items-center rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })
            )}
          </div>

          {currentKey === "crisis" && (crisis === "thoughts" || crisis === "plan") && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-800 dark:text-red-200">
              If you are in immediate danger, call 112 or KIRAN 1800-599-0019 / Tele-MANAS 14416.
              Your counsellor will be notified right away.
            </p>
          )}

          {error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="mt-6 flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={step === 0 || submitting}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </Button>
            <Button type="button" className="flex-1" disabled={submitting} onClick={next}>
              {submitting
                ? "Saving…"
                : step >= STEP_KEYS.length - 1
                  ? "Finish & meet your counsellor"
                  : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
