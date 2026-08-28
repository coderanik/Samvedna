"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { CrisisNotice } from "@/components/crisis-notice";
import { AiVoiceCall } from "@/components/ai-voice-call";
import { RiskBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import { connectSocket, onCallAccepted } from "@/lib/socket";
import type { CallRouting, CallSession } from "@samvedna/shared-types";
import { Phone, PhoneCall, Bot, User, CheckCircle2, AlertCircle } from "lucide-react";

type CallPhase = "idle" | "counsellor" | "counsellor_active" | "ai" | "done";

export default function VictimCallPage() {
  const [routing, setRouting] = useState<CallRouting | null>(null);
  const [session, setSession] = useState<CallSession | null>(null);
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("en");
  const [error, setError] = useState("");
  const [doneMessage, setDoneMessage] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) return;
      setToken(s.access_token);
      setUserId(s.user.id);
      connectSocket(s.user.id);

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", s.user.id).single();
      setName(prof?.full_name ?? "");
      setLocale(prof?.preferred_language ?? "en");

      try {
        const r = await apiFetch<CallRouting>("/calls/routing", { token: s.access_token });
        setRouting(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load call routing");
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!userId || phase !== "counsellor" || !session?.id || !token) return;

    const handleAccepted = (payload: { call_session_id: string }) => {
      if (payload.call_session_id === session.id) {
        setPhase("counsellor_active");
      }
    };

    const unsub = onCallAccepted(handleAccepted);

    pollRef.current = setInterval(async () => {
      try {
        const updated = await apiFetch<CallSession>(`/calls/${session.id}/status`, { token });
        if (updated.status === "in_progress") setPhase("counsellor_active");
        if (updated.status === "completed") {
          setPhase("done");
          setDoneMessage("Your counsellor call has been completed and saved. Thank you for checking in.");
        }
      } catch {
        /* ignore poll errors */
      }
    }, 3000);

    return () => {
      unsub();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [userId, phase, session?.id, token]);

  async function initiateCall() {
    if (!token) return;
    setError("");
    try {
      const s = await apiFetch<CallSession>("/calls/start", {
        method: "POST",
        token,
      });
      setSession(s);
      setPhase(s.call_type === "counsellor" ? "counsellor" : "ai");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start call");
    }
  }

  async function cancelCall() {
    if (session && token) {
      await apiFetch(`/calls/${session.id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status: "cancelled" }),
      }).catch(() => {});
    }
    setSession(null);
    setPhase("idle");
  }

  function handleAiComplete(_transcript: string, _duration: number) {
    setPhase("done");
    setDoneMessage(
      "Your AI wellness call has been saved and scored. Thank you for checking in."
    );
  }

  if (!routing && !error) {
    return (
      <AppShell userName={name}>
        <p className="text-muted-foreground">Loading call options…</p>
      </AppShell>
    );
  }

  const isCounsellorCall = routing?.call_type === "counsellor";

  return (
    <AppShell userName={name}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Well-being call</h1>
          <p className="text-muted-foreground">
            Based on your current distress level, you&apos;ll be connected the right way.
          </p>
        </div>

        <CrisisNotice locale={locale} />

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {routing && phase === "idle" && (
          <>
            <Card className={isCounsellorCall ? "border-risk-high/40" : "border-primary/30"}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    {isCounsellorCall ? (
                      <>
                        <User className="h-5 w-5 text-risk-high" />
                        Counsellor call required
                      </>
                    ) : (
                      <>
                        <Bot className="h-5 w-5 text-primary" />
                        AI wellness call
                      </>
                    )}
                  </CardTitle>
                  <RiskBadge level={routing.risk_level} score={routing.distress_score ?? undefined} />
                </div>
                <CardDescription>{routing.reason}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-muted/50 p-4 text-sm">
                  {isCounsellorCall ? (
                    <>
                      <p className="font-medium">High / critical distress → human counsellor</p>
                      <p className="mt-2 text-muted-foreground">
                        Because your distress level is <strong>{routing.risk_level}</strong>, you
                        will speak directly with your assigned counsellor — not an AI.
                      </p>
                      {routing.counsellor && (
                        <p className="mt-3">
                          Counsellor: <strong>{routing.counsellor.full_name}</strong>
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Low / moderate distress → AI voice call</p>
                      <p className="mt-2 text-muted-foreground">
                        Mann-Mitra (AI) will speak with you in your language using voice. Your
                        counsellor is notified if your distress rises.
                      </p>
                    </>
                  )}
                </div>

                <Button size="lg" className="w-full" onClick={initiateCall}>
                  <PhoneCall className="mr-2 h-5 w-5" />
                  {isCounsellorCall ? "Request counsellor call" : "Start AI voice call"}
                </Button>
              </CardContent>
            </Card>

            <p className="text-center text-xs text-muted-foreground">
              Case {routing.case_number} · Routing rule: high/critical → counsellor · low/moderate → AI
            </p>
          </>
        )}

        {phase === "counsellor" && session && routing?.counsellor && (
          <Card className="border-risk-high/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 animate-pulse text-risk-high" />
                Waiting for counsellor…
              </CardTitle>
              <CardDescription>
                Your counsellor has been notified. You&apos;ll see when they accept the call.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <div className="rounded-lg bg-risk-high/5 p-6">
                <p className="text-lg font-semibold">{routing.counsellor.full_name}</p>
                <p className="text-sm text-muted-foreground">Your assigned counsellor</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Session {session.id.slice(0, 8)}… · Status: requested
              </p>
              <Button variant="outline" onClick={cancelCall}>
                Cancel request
              </Button>
            </CardContent>
          </Card>
        )}

        {phase === "counsellor_active" && session && routing?.counsellor && (
          <Card className="border-accent/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-accent">
                <CheckCircle2 className="h-5 w-5" />
                Counsellor is ready
              </CardTitle>
              <CardDescription>
                Your counsellor accepted the call. Tap below to speak with them.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <div className="rounded-lg bg-accent/5 p-6">
                <p className="text-lg font-semibold">{routing.counsellor.full_name}</p>
                {routing.counsellor.phone_number ? (
                  <a
                    href={`tel:${routing.counsellor.phone_number.replace(/\s/g, "")}`}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-lg font-bold text-accent-foreground"
                  >
                    <Phone className="h-5 w-5" />
                    Call counsellor now
                  </a>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Your counsellor will call you on your registered number.
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={cancelCall}>
                End call request
              </Button>
            </CardContent>
          </Card>
        )}

        {phase === "ai" && session && token && (
          <AiVoiceCall
            token={token}
            locale={locale}
            sessionId={session.id}
            onComplete={handleAiComplete}
            onCancel={cancelCall}
          />
        )}

        {phase === "done" && (
          <Card className="border-accent/40">
            <CardContent className="flex flex-col items-center gap-4 pt-8">
              <CheckCircle2 className="h-12 w-12 text-accent" />
              <p className="text-center font-medium">{doneMessage}</p>
              <Button onClick={() => { setPhase("idle"); setSession(null); setDoneMessage(""); }}>
                Done
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
