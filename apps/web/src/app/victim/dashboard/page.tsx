"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { AiVoiceCall } from "@/components/ai-voice-call";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/client";
import { apiFetch, cn } from "@/lib/utils";
import { connectSocket } from "@/lib/socket";
import { Phone, CalendarDays, Activity, MessageSquare, PhoneCall, Loader2 } from "lucide-react";

type DashboardPayload = {
  welcome: { first_name: string; full_name: string; preferred_language: string };
  summary: {
    instant_calls_made: number;
    consultant_meets: number;
    latest_score: { id: string; score: number; source: string | null; created_at: string } | null;
    score_trend: Array<{ score: number; at: string; source: string | null }>;
  };
  last_call_summary: {
    id: string;
    summary: string | null;
    created_at: string;
    duration_seconds: number | null;
  } | null;
  case: { case_number: string; status: string } | null;
};

type Caps = {
  browser_voice: boolean;
  twilio_outbound: boolean;
  twilio_live: boolean;
  has_phone: boolean;
  preferred_mode: "twilio" | "browser";
  label: string;
};

type InstantStart = {
  instant_call: { id: string; status?: string; twilio_call_sid?: string };
  call_session: { id: string };
  mode: "twilio" | "browser";
  to?: string;
  preferred_language?: string;
  honesty?: string;
};

type InstantStatus = {
  id: string;
  status: string;
  summary: string | null;
  twilio_call_sid: string | null;
};

export default function VictimDashboardPage() {
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [error, setError] = useState("");
  const [calling, setCalling] = useState(false);
  const [twilioPhase, setTwilioPhase] = useState<
    null | "ringing" | "in_progress" | "completing"
  >(null);
  const [twilioTo, setTwilioTo] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [instantId, setInstantId] = useState("");
  const [locale, setLocale] = useState("en");
  const [doneMsg, setDoneMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load(accessToken: string) {
    const [d, c] = await Promise.all([
      apiFetch<DashboardPayload>("/victim/dashboard", { token: accessToken }),
      apiFetch<Caps>("/victim/instant-calls/capabilities", { token: accessToken }).catch(
        () => null
      ),
    ]);
    setData(d);
    setName(d.welcome.full_name);
    setLocale(d.welcome.preferred_language || "en");
    if (c) setCaps(c);
  }

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
      try {
        await load(session.access_token);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load dashboard");
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!twilioPhase || !instantId || !token) return;

    pollRef.current = setInterval(async () => {
      try {
        const row = await apiFetch<InstantStatus>(`/victim/instant-calls/${instantId}`, {
          token,
        });
        if (row.status === "in_progress" || row.status === "answered") {
          setTwilioPhase("in_progress");
        }
        if (
          row.status === "completed" ||
          row.status === "busy" ||
          row.status === "failed" ||
          row.status === "no-answer" ||
          row.status === "canceled"
        ) {
          setTwilioPhase(null);
          setDoneMsg(
            row.summary
              ? "Your phone call with Mann-Mitra is saved. Summary is below."
              : row.status === "completed"
                ? "Call ended. Summary will appear shortly."
                : `Call ended (${row.status}). You can try again anytime.`
          );
          await load(token);
        }
      } catch {
        /* ignore poll errors */
      }
    }, 2500);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [twilioPhase, instantId, token]);

  useEffect(() => {
    if (!userId || !twilioPhase) return;
    const s = connectSocket(userId);
    const onDone = (payload: { instant_call_id: string; summary?: string }) => {
      if (payload.instant_call_id !== instantId) return;
      setTwilioPhase(null);
      setDoneMsg("Your phone call with Mann-Mitra is saved. Summary is below.");
      load(token);
    };
    const onStatus = (payload: { instant_call_id: string; status: string }) => {
      if (payload.instant_call_id !== instantId) return;
      if (payload.status === "in_progress" || payload.status === "answered") {
        setTwilioPhase("in_progress");
      }
    };
    s.on("instant_call_completed", onDone);
    s.on("instant_call_status", onStatus);
    return () => {
      s.off("instant_call_completed", onDone);
      s.off("instant_call_status", onStatus);
    };
  }, [userId, twilioPhase, instantId, token]);

  const chartData = useMemo(
    () =>
      (data?.summary.score_trend ?? []).map((p, i) => ({
        i: i + 1,
        score: p.score,
        label: new Date(p.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      })),
    [data]
  );

  async function startInstantCall(forceMode?: "auto" | "browser" | "twilio") {
    if (!token) return;
    setError("");
    setDoneMsg("");
    try {
      const started = await apiFetch<InstantStart>("/victim/instant-calls/start", {
        method: "POST",
        token,
        body: JSON.stringify({ mode: forceMode ?? "auto" }),
      });
      setInstantId(started.instant_call.id);
      setSessionId(started.call_session.id);

      if (started.mode === "twilio") {
        setTwilioTo(started.to ?? "your phone");
        setTwilioPhase("ringing");
        return;
      }

      setCalling(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start call");
    }
  }

  async function onCallComplete(transcript: string, durationSeconds: number) {
    setCalling(false);
    try {
      await apiFetch(`/victim/instant-calls/${instantId}/complete`, {
        method: "POST",
        token,
        body: JSON.stringify({ transcript, duration_seconds: durationSeconds }),
      });
      setDoneMsg("Your call notes are saved. A private summary appears below.");
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save call summary");
    }
  }

  if (calling && sessionId && token) {
    return (
      <AppShell role="victim" userName={name}>
        <AiVoiceCall
          token={token}
          locale={locale}
          sessionId={sessionId}
          persistViaCallsApi={false}
          onComplete={onCallComplete}
          onCancel={() => setCalling(false)}
        />
      </AppShell>
    );
  }

  if (twilioPhase) {
    return (
      <AppShell role="victim" userName={name}>
        <Card className="mx-auto max-w-md border-primary/20">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              {twilioPhase === "ringing" ? (
                <PhoneCall className="h-9 w-9 animate-pulse text-primary" />
              ) : (
                <Loader2 className="h-9 w-9 animate-spin text-primary" />
              )}
            </div>
            <CardTitle className="font-display text-2xl">
              {twilioPhase === "ringing" ? "Calling your phone…" : "Connected with Mann-Mitra"}
            </CardTitle>
            <CardDescription>
              {twilioPhase === "ringing"
                ? `Answer the call on ${twilioTo}. Speak naturally — Mann-Mitra is listening.`
                : "Stay on the line. When you hang up, a private summary is saved here."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-center text-sm text-muted-foreground">
            <p>LIVE Twilio Conversational Voice</p>
            <Button
              variant="outline"
              onClick={() => {
                setTwilioPhase(null);
                load(token);
              }}
            >
              Return to dashboard
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const twilioLive = caps?.twilio_live === true;

  return (
    <AppShell role="victim" userName={name}>
      <div className="space-y-6 sm:space-y-8">
        <header className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
            Your space
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl md:text-4xl">
            Welcome back, {data?.welcome.first_name ?? "…"}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Check in, talk with Mann-Mitra, or book time with your allotted counsellor — at your pace.
          </p>
        </header>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {doneMsg && <p className="text-sm text-primary">{doneMsg}</p>}

        <div className="grid grid-cols-1 gap-3 xs:grid-cols-1 sm:grid-cols-3 sm:gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5" /> Instant calls
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums sm:text-3xl">
                {data?.summary.instant_calls_made ?? "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              AI agent conversations started by you
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <CalendarDays className="h-3.5 w-3.5" /> Consultant meets
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums sm:text-3xl">
                {data?.summary.consultant_meets ?? "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Scheduled or completed sessions
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5" /> Wellbeing pulse
              </CardDescription>
              <CardTitle className="text-2xl tabular-nums sm:text-3xl">
                {data?.summary.latest_score?.score ?? "—"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Latest private check-in signal
              {data?.summary.latest_score?.source
                ? ` · ${data.summary.latest_score.source}`
                : ""}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] lg:gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-xl">Pulse over time</CardTitle>
              <CardDescription>Recent check-in signals (private to you)</CardDescription>
            </CardHeader>
            <CardContent className="h-48">
              {chartData.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(175 76% 25%)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(175 76% 25%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v: number) => [v, "Pulse"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(175 76% 25%)"
                      fill="url(#pulseFill)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Complete a chat or call check-in to see your trend.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={cn("border-primary/20 bg-primary/[0.03]")}>
            <CardHeader>
              <CardTitle className="font-display text-xl">Talk to an Agent Now</CardTitle>
              <CardDescription>
                {twilioLive
                  ? "We call your registered phone. Mann-Mitra listens, replies, and saves a private summary."
                  : "Instant conversational AI with Mann-Mitra. Your words stay private and update your wellbeing pulse."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button size="lg" className="w-full" onClick={() => startInstantCall("auto")} disabled={!token}>
                <Phone className="mr-2 h-4 w-4" />
                Talk to an Agent Now
              </Button>
              <div className="flex flex-wrap gap-2">
                {twilioLive && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startInstantCall("browser")}
                    disabled={!token}
                  >
                    Use in-browser voice instead
                  </Button>
                )}
                {caps?.twilio_outbound && !twilioLive && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startInstantCall("twilio")}
                    disabled={!token}
                  >
                    Try Twilio phone call
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {twilioLive
                  ? "LIVE · Twilio Conversational Voice → your phone"
                  : caps?.twilio_outbound
                    ? `Twilio ${caps.label}. Add phone on Profile + set TWILIO_WEBHOOK_BASE_URL (HTTPS) for phone calls. Browser voice is LIVE.`
                    : "LIVE in-browser Mann-Mitra. Configure TWILIO_* for phone Conversational Voice."}
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                <Link href="/victim/chatbot" className="text-primary underline-offset-4 hover:underline">
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="h-3.5 w-3.5" /> Open chatbot
                  </span>
                </Link>
                <Link
                  href="/victim/consultant"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Book consultant
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {data?.last_call_summary?.summary && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Last call summary</CardTitle>
              <CardDescription>
                {new Date(data.last_call_summary.created_at).toLocaleString("en-IN")}
                {data.last_call_summary.duration_seconds
                  ? ` · ${data.last_call_summary.duration_seconds}s`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-foreground/90">
                {data.last_call_summary.summary}
              </p>
            </CardContent>
          </Card>
        )}

        {data?.case && (
          <p className="text-xs text-muted-foreground">
            Linked case {data.case.case_number} · {data.case.status.replace(/_/g, " ")}
          </p>
        )}
      </div>
    </AppShell>
  );
}
