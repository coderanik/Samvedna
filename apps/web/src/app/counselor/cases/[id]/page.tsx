"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { CounsellorShell } from "@/components/counsellor-shell";
import { RiskBadge, TrendBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, cn } from "@/lib/utils";
import { connectSocket, joinCaseRoom } from "@/lib/socket";
import { ScoreWaterfall } from "@/components/score-waterfall";
import { ForecastCone, type ForecastPoint } from "@/components/forecast-cone";
import { VoiceNoteUpload } from "@/components/voice-note-upload";
import type { CaseStatus, CaseTimeline, SupportRecommendationV2 } from "@samvedna/shared-types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const STAGES: CaseStatus[] = [
  "complaint_registration",
  "investigation",
  "trial",
  "compensation",
  "rehabilitation",
  "protection_followup",
  "closed",
];

const PANELS = [
  { id: "overview", label: "Overview" },
  { id: "intel", label: "Case intelligence" },
  { id: "distress", label: "Longitudinal distress" },
  { id: "justice", label: "Justice stage" },
  { id: "checkins", label: "Check-ins" },
  { id: "interventions", label: "Interventions" },
  { id: "notes", label: "Notes" },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

function isPanelId(v: string | null): v is PanelId {
  return PANELS.some((p) => p.id === v);
}

function CounsellorCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const panelParam = searchParams.get("panel");
  const panel: PanelId = isPanelId(panelParam) ? panelParam : "overview";

  const [timeline, setTimeline] = useState<CaseTimeline | null>(null);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [bailBusy, setBailBusy] = useState(false);
  const [explain, setExplain] = useState<{
    contributions: Array<{
      feature_label: string;
      contribution: number;
      direction: string;
      evidence: string;
      channel: string;
    }>;
  } | null>(null);
  const [forecastCone, setForecastCone] = useState<ForecastPoint[]>([]);
  const [forecastMeta, setForecastMeta] = useState<{
    honesty?: string;
    risk7d?: number | null;
    method?: string;
  }>({});

  function setPanel(next: PanelId) {
    router.replace(`/counselor/cases/${id}?panel=${next}`, { scroll: false });
  }

  function slaCountdown(dueAt: string | null | undefined, breached?: boolean | null) {
    if (!dueAt) return null;
    const ms = new Date(dueAt).getTime() - Date.now();
    const hours = Math.round(ms / 36e5);
    if (breached || hours < 0) return { label: `${Math.abs(hours)}h overdue`, breached: true };
    if (hours < 24) return { label: `${hours}h left`, breached: false };
    return { label: `${Math.round(hours / 24)}d left`, breached: false };
  }

  async function grantBail() {
    if (!token || bailBusy) return;
    setBailBusy(true);
    try {
      await apiFetch(`/cases/${id}/bail`, { method: "PATCH", token, body: "{}" });
      setMsg("Bail playbook fired — witness protection recommendations opened.");
      await loadTimeline(token);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Bail update failed");
    } finally {
      setBailBusy(false);
    }
  }

  async function loadTimeline(accessToken: string) {
    const data = await apiFetch<CaseTimeline>(`/cases/${id}/timeline`, { token: accessToken });
    setTimeline(data);
    const latestId = data.checkins
      .map((c) => c.distress_score?.id)
      .filter(Boolean)
      .at(-1);
    if (latestId) {
      try {
        const ex = await apiFetch<{
          contributions: Array<{
            feature_label: string;
            contribution: number;
            direction: string;
            evidence: string;
            channel: string;
          }>;
        }>(`/cases/${id}/scores/${latestId}/explain`, { token: accessToken });
        setExplain(ex);
      } catch {
        setExplain(null);
      }
    }
    try {
      const fc = await apiFetch<{
        forecast: {
          predicted_score: number;
          ci_lower: number;
          ci_upper: number;
          crisis_probability: number;
          risk_7d?: number;
          method: string;
          trajectory: Array<{ day: number; score: number; lower: number; upper: number }>;
          disclaimer: string;
          escalation_model?: { method?: string; risk_7d?: number };
        } | null;
        honesty: string;
        history_points: number;
      }>(`/cases/${id}/forecast`, { token: accessToken });

      const history: ForecastPoint[] = (data.checkins ?? [])
        .filter((c) => c.distress_score)
        .map((c, i) => ({
          day: `H${i + 1}`,
          score: c.distress_score!.score,
          predicted: null,
          lower: null,
          upper: null,
        }));

      const traj = fc.forecast?.trajectory ?? [];
      const forecastPts: ForecastPoint[] = traj.map((t) => ({
        day: `+${t.day}d`,
        score: null,
        predicted: t.score,
        lower: t.lower,
        upper: t.upper,
      }));

      // Bridge: last history point also starts the cone
      if (history.length && forecastPts.length) {
        const last = history[history.length - 1];
        history[history.length - 1] = {
          ...last,
          predicted: last.score,
          lower: last.score,
          upper: last.score,
        };
      }

      setForecastCone([...history, ...forecastPts]);
      setForecastMeta({
        honesty: fc.honesty ?? fc.forecast?.disclaimer,
        risk7d: fc.forecast?.risk_7d ?? fc.forecast?.escalation_model?.risk_7d ?? null,
        method: fc.forecast?.escalation_model?.method ?? fc.forecast?.method,
      });
    } catch {
      setForecastCone([]);
      setForecastMeta({});
    }
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
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();
      setName(prof?.full_name ?? "");
      connectSocket(session.user.id);
      joinCaseRoom(id);
      await loadTimeline(session.access_token);
    }
    init();
  }, [id]);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim() || !token) return;
    setSaving(true);
    try {
      await apiFetch(`/cases/${id}/notes`, {
        method: "POST",
        token,
        body: JSON.stringify({ note }),
      });
      setNote("");
      await loadTimeline(token);
    } finally {
      setSaving(false);
    }
  }

  async function setSupportStatus(supportId: string, status: string) {
    if (!token) return;
    await apiFetch(`/cases/${id}/support/${supportId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status }),
    });
    await loadTimeline(token);
    setMsg("Intervention status updated.");
  }

  async function updateStage(status: CaseStatus) {
    if (!token) return;
    await apiFetch(`/cases/${id}/status`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status }),
    });
    await loadTimeline(token);
    setMsg("Case stage updated.");
  }

  const chartData = useMemo(
    () =>
      (timeline?.checkins ?? [])
        .filter((c) => c.distress_score)
        .map((c) => ({
          date: new Date(c.created_at).toLocaleDateString(),
          score: c.distress_score!.score,
        })),
    [timeline]
  );

  if (!timeline) {
    return (
      <CounsellorShell userName={name} userId={userId} token={token}>
        <p className="px-6 py-12 text-[var(--sanctuary-ink-2)]">Loading patient home…</p>
      </CounsellorShell>
    );
  }

  const victim = timeline.case.victim as { full_name?: string } | undefined;
  const intel = timeline.intelligence;
  const latest = timeline.checkins.filter((c) => c.distress_score).at(-1)?.distress_score;
  const lastCheckin = timeline.checkins.at(-1);

  const rail = (
    <nav className="space-y-0.5 p-2 sm:p-3" aria-label="Case parameters">
      <Link
        href="/counselor/cases"
        className="mb-3 block rounded-md px-3 py-2 text-xs font-medium text-[var(--sanctuary-ink-2)] hover:bg-[var(--sanctuary-sand)]/40 hover:text-[var(--sanctuary-ink)]"
      >
        ← Back to queue
      </Link>
      {PANELS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setPanel(p.id)}
          className={cn(
            "flex w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
            panel === p.id
              ? "bg-[var(--sanctuary-teal)]/10 font-medium text-[var(--sanctuary-teal)]"
              : "text-[var(--sanctuary-ink-2)] hover:bg-[var(--sanctuary-sand)]/40 hover:text-[var(--sanctuary-ink)]"
          )}
        >
          {p.label}
        </button>
      ))}
    </nav>
  );

  return (
    <CounsellorShell userName={name} userId={userId} token={token}>
      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col lg:flex-row">
        {/* Desktop left rail */}
        <aside className="hidden w-56 shrink-0 border-r border-[var(--sanctuary-sand)] bg-[var(--sanctuary-sand)]/20 lg:block">
          {rail}
        </aside>

        <div className="min-w-0 flex-1">
          {/* Patient header */}
          <header className="border-b border-[var(--sanctuary-sand)] px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sanctuary-ink-3)]">
                  Patient home
                </p>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--sanctuary-ink)] sm:text-3xl">
                  {victim?.full_name ?? "Survivor"}
                </h1>
                <p className="text-sm text-[var(--sanctuary-ink-2)]">
                  {timeline.case.case_number} · {timeline.case.case_type} ·{" "}
                  {timeline.case.district}, {timeline.case.state}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {latest && <RiskBadge level={latest.risk_level} score={latest.score} />}
                <TrendBadge trend={intel?.trend_direction ?? latest?.trend_direction} />
                {(intel?.escalation_risk_7d ?? latest?.escalation_risk_7d) != null && (
                  <span className="rounded-md border border-[var(--sanctuary-sand)] px-2 py-1 text-xs tabular-nums text-[var(--sanctuary-ink-2)]">
                    Esc 7d {intel?.escalation_risk_7d ?? latest?.escalation_risk_7d}
                  </span>
                )}
              </div>
            </div>

            {/* Mobile panel chips */}
            <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
              {PANELS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPanel(p.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                    panel === p.id
                      ? "border-[var(--sanctuary-teal)] bg-[var(--sanctuary-teal)]/10 text-[var(--sanctuary-teal)]"
                      : "border-[var(--sanctuary-sand)] text-[var(--sanctuary-ink-2)]"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </header>

          {msg && (
            <p className="mx-4 mt-4 rounded-md border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-sand)]/30 px-3 py-2 text-sm sm:mx-6">
              {msg}
            </p>
          )}

          <div className="px-4 py-6 sm:px-6">
            {panel === "overview" && (
              <section className="max-w-2xl space-y-6">
                <div>
                  <h2 className="font-display text-xl text-[var(--sanctuary-ink)]">Overview</h2>
                  <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">
                    Snapshot for triage — open a parameter for full detail.
                  </p>
                </div>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--sanctuary-sand)] p-4">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                      Risk
                    </dt>
                    <dd className="mt-2">
                      {latest ? (
                        <RiskBadge level={latest.risk_level} score={latest.score} />
                      ) : (
                        <span className="text-sm text-[var(--sanctuary-ink-2)]">No score yet</span>
                      )}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-[var(--sanctuary-sand)] p-4">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                      Trend
                    </dt>
                    <dd className="mt-2">
                      <TrendBadge trend={intel?.trend_direction ?? latest?.trend_direction} />
                    </dd>
                  </div>
                  <div className="rounded-lg border border-[var(--sanctuary-sand)] p-4">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                      Escalation (7d)
                    </dt>
                    <dd className="mt-2 font-display text-2xl tabular-nums text-[var(--sanctuary-teal)]">
                      {intel?.escalation_risk_7d ?? latest?.escalation_risk_7d ?? "—"}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-[var(--sanctuary-sand)] p-4">
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                      Avg distress
                    </dt>
                    <dd className="mt-2 font-display text-2xl tabular-nums text-[var(--sanctuary-ink)]">
                      {intel?.average_score ?? "—"}
                    </dd>
                  </div>
                </dl>
                <div className="rounded-lg border border-[var(--sanctuary-sand)] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                    Recommended action
                  </p>
                  <p className="mt-2 text-sm font-medium text-[var(--sanctuary-ink)]">
                    {intel?.recommended_action ?? "Continue routine check-ins."}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--sanctuary-sand)] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                    Last check-in
                  </p>
                  {lastCheckin ? (
                    <>
                      <p className="mt-2 text-xs text-[var(--sanctuary-ink-3)]">
                        {new Date(lastCheckin.created_at).toLocaleString()} · {lastCheckin.channel}
                      </p>
                      <p className="mt-2 line-clamp-4 text-sm text-[var(--sanctuary-ink-2)]">
                        {lastCheckin.raw_transcript || "No transcript captured."}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--sanctuary-ink-2)]">
                      No check-ins yet — the sanctuary is quiet until the first conversation.
                    </p>
                  )}
                </div>
                <p className="text-[11px] text-[var(--sanctuary-ink-3)]">
                  {intel?.disclaimer ??
                    "Decision-support only — not a clinical diagnosis. Scores are never shown to survivors."}
                </p>
              </section>
            )}

            {panel === "intel" && (
              <section className="max-w-3xl space-y-6">
                <div>
                  <h2 className="font-display text-xl text-[var(--sanctuary-ink)]">
                    Case intelligence
                  </h2>
                  <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">
                    Detect → understand → predict → recommend (human decides)
                  </p>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                        Why flagged
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[var(--sanctuary-ink)]">
                        {(intel?.why_flagged ?? [`Distress: ${latest?.score ?? "—"}`]).map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                        Recommended action
                      </p>
                      <p className="mt-2 text-sm font-medium">
                        {intel?.recommended_action ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                      Score contributions
                    </p>
                    <ScoreWaterfall contributions={explain?.contributions ?? []} />
                  </div>
                </div>
              </section>
            )}

            {panel === "distress" && (
              <section className="max-w-3xl space-y-4">
                <div>
                  <h2 className="font-display text-xl text-[var(--sanctuary-ink)]">
                    Longitudinal distress
                  </h2>
                  <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">
                    0–100 private counsellor view across check-ins.
                  </p>
                </div>
                <div className="h-72 rounded-lg border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] p-2">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--sanctuary-sand)" />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="var(--sanctuary-teal)"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                      <p className="font-display text-lg text-[var(--sanctuary-ink)]">
                        No distress trail yet
                      </p>
                      <p className="mt-2 max-w-sm text-sm text-[var(--sanctuary-ink-2)]">
                        When this survivor checks in by chat or voice, the curve will settle here —
                        calmly, for your eyes only.
                      </p>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] p-4">
                  <h3 className="font-display text-lg text-[var(--sanctuary-ink)]">
                    7-day forecast cone
                  </h3>
                  <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">
                    Decision support only — not a clinical prediction.
                  </p>
                  <div className="mt-3">
                    <ForecastCone
                      data={forecastCone}
                      honesty={forecastMeta.honesty}
                      risk7d={forecastMeta.risk7d}
                      method={forecastMeta.method}
                    />
                  </div>
                </div>

                <VoiceNoteUpload caseId={id} token={token} forCounsellor />
              </section>
            )}

            {panel === "justice" && (
              <section className="max-w-md space-y-4">
                <div>
                  <h2 className="font-display text-xl text-[var(--sanctuary-ink)]">Justice stage</h2>
                  <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">
                    Distress often shifts across complaint → investigation → trial → compensation →
                    rehabilitation.
                  </p>
                </div>
                <p className="text-sm capitalize text-[var(--sanctuary-ink-2)]">
                  Current: {timeline.case.status.replace(/_/g, " ")}
                </p>
                <select
                  className="flex h-10 w-full rounded-md border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] px-3 text-sm"
                  value={timeline.case.status}
                  onChange={(e) => updateStage(e.target.value as CaseStatus)}
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>

                <div className="rounded-lg border border-[var(--sanctuary-sand)] p-4">
                  <p className="text-sm font-medium text-[var(--sanctuary-ink)]">Accused bail</p>
                  <p className="mt-1 text-xs text-[var(--sanctuary-ink-3)]">
                    Status:{" "}
                    {(timeline.case as { accused_bail_status?: string }).accused_bail_status ??
                      "not recorded"}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    disabled={bailBusy}
                    onClick={grantBail}
                  >
                    {bailBusy ? "Running playbook…" : "Simulate bail → protection playbook"}
                  </Button>
                  <p className="mt-2 text-[11px] text-[var(--sanctuary-ink-3)]">
                    Fires witness intimidation pathway with SLA-bound PoA interventions. Demo
                    connector — not a live court feed.
                  </p>
                </div>
              </section>
            )}

            {panel === "checkins" && (
              <section className="max-w-2xl space-y-4">
                <div>
                  <h2 className="font-display text-xl text-[var(--sanctuary-ink)]">
                    Check-ins & reasons
                  </h2>
                  <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">
                    Transcripts with model rationale and signal chips.
                  </p>
                </div>
                <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                  {timeline.checkins.length === 0 && (
                    <p className="rounded-lg border border-dashed border-[var(--sanctuary-sand)] px-4 py-8 text-center text-sm text-[var(--sanctuary-ink-2)]">
                      No check-ins yet.
                    </p>
                  )}
                  {timeline.checkins.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg border border-[var(--sanctuary-sand)] p-3 text-sm"
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-[var(--sanctuary-ink-3)]">
                          {new Date(c.created_at).toLocaleString()} · {c.channel}
                        </span>
                        {c.distress_score && (
                          <RiskBadge
                            level={c.distress_score.risk_level}
                            score={c.distress_score.score}
                          />
                        )}
                      </div>
                      <p className="mb-2 text-[var(--sanctuary-ink-2)]">{c.raw_transcript}</p>
                      {c.distress_score && (
                        <>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                            Why
                          </p>
                          <p className="mt-1">{c.distress_score.reasoning}</p>
                          {c.distress_score.signals_detected?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(c.distress_score.signals_detected as string[]).map((s) => (
                                <span
                                  key={s}
                                  className="rounded-md bg-[var(--sanctuary-sand)]/60 px-2 py-0.5 text-xs"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {panel === "interventions" && (
              <section className="max-w-2xl space-y-4">
                <div>
                  <h2 className="font-display text-xl text-[var(--sanctuary-ink)]">
                    Recommended interventions
                  </h2>
                  <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">
                    For authorised professionals — not automated orders.
                  </p>
                </div>
                <div className="space-y-2">
                  {timeline.support_recommendations.map((raw) => {
                    const s = raw as SupportRecommendationV2;
                    const clock = slaCountdown(s.due_at, s.sla_breached);
                    return (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--sanctuary-sand)] p-3 text-sm"
                      >
                        <div>
                          <span className="font-medium capitalize">
                            {s.type.replace(/_/g, " ")}
                          </span>
                          {s.catalog_code && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--sanctuary-ink-3)]">
                              {s.catalog_code}
                            </span>
                          )}
                          <p className="text-[var(--sanctuary-ink-2)]">{s.description}</p>
                          {clock && (
                            <p
                              className={`mt-1 text-xs ${
                                clock.breached
                                  ? "text-[var(--sanctuary-terracotta)]"
                                  : "text-[var(--sanctuary-ink-3)]"
                              }`}
                            >
                              SLA {clock.label}
                              {s.sla_hours != null ? ` · ${s.sla_hours}h clock` : ""}
                              {s.responsible_authority
                                ? ` · ${s.responsible_authority}`
                                : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {s.status !== "in_progress" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSupportStatus(s.id, "in_progress")}
                            >
                              Start
                            </Button>
                          )}
                          {s.status !== "completed" && (
                            <Button size="sm" onClick={() => setSupportStatus(s.id, "completed")}>
                              Done
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {timeline.support_recommendations.length === 0 && (
                    <p className="rounded-lg border border-dashed border-[var(--sanctuary-sand)] px-4 py-8 text-center text-sm text-[var(--sanctuary-ink-2)]">
                      No recommendations yet — they appear after scored check-ins.
                    </p>
                  )}
                </div>
              </section>
            )}

            {panel === "notes" && (
              <section className="max-w-xl space-y-4">
                <div>
                  <h2 className="font-display text-xl text-[var(--sanctuary-ink)]">
                    Counsellor notes
                  </h2>
                  <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">
                    Private clinical notes for this case.
                  </p>
                </div>
                <form onSubmit={addNote} className="flex gap-2">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add intervention note…"
                  />
                  <Button type="submit" disabled={saving}>
                    Add
                  </Button>
                </form>
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {timeline.intervention_notes.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-lg border border-[var(--sanctuary-sand)] p-3 text-sm"
                    >
                      <p className="text-xs text-[var(--sanctuary-ink-3)]">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                      <p className="mt-1">{n.note}</p>
                    </div>
                  ))}
                  {timeline.intervention_notes.length === 0 && (
                    <p className="rounded-lg border border-dashed border-[var(--sanctuary-sand)] px-4 py-8 text-center text-sm text-[var(--sanctuary-ink-2)]">
                      No notes yet.
                    </p>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </CounsellorShell>
  );
}


export default function CounsellorCaseDetailPageSuspense() {
  return (
    <Suspense
      fallback={
        <div className="theme-sanctuary min-h-screen px-6 py-12 text-[var(--sanctuary-ink-2)]">
          Loading patient home…
        </div>
      }
    >
      <CounsellorCaseDetailPage />
    </Suspense>
  );
}
