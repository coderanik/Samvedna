"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { AlertToast } from "@/components/alert-toast";
import { RiskBadge, TrendBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import { connectSocket, joinCaseRoom } from "@/lib/socket";
import { ScoreWaterfall } from "@/components/score-waterfall";
import type { CaseStatus, CaseTimeline } from "@samvedna/shared-types";
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

export default function CounsellorCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [timeline, setTimeline] = useState<CaseTimeline | null>(null);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [explain, setExplain] = useState<{
    contributions: Array<{
      feature_label: string;
      contribution: number;
      direction: string;
      evidence: string;
      channel: string;
    }>;
  } | null>(null);

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

  if (!timeline) {
    return (
      <AppShell role="counsellor">
        <p className="text-muted-foreground">Loading case intelligence…</p>
      </AppShell>
    );
  }

  const chartData = timeline.checkins
    .filter((c) => c.distress_score)
    .map((c) => ({
      date: new Date(c.created_at).toLocaleDateString(),
      score: c.distress_score!.score,
    }));

  const victim = timeline.case.victim as { full_name?: string } | undefined;
  const intel = timeline.intelligence;
  const latest = timeline.checkins.filter((c) => c.distress_score).at(-1)?.distress_score;

  return (
    <AppShell role="counsellor" userName="">
      {userId && <AlertToast userId={userId} />}
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{timeline.case.case_number}</h1>
            <p className="text-muted-foreground">
              {victim?.full_name} · {timeline.case.case_type} · {timeline.case.district},{" "}
              {timeline.case.state}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {latest && <RiskBadge level={latest.risk_level} score={latest.score} />}
            <TrendBadge trend={intel?.trend_direction ?? latest?.trend_direction} />
          </div>
        </div>

        {msg && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{msg}</p>
        )}

        {/* Case Intelligence */}
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardHeader>
            <CardTitle className="text-base">Case intelligence</CardTitle>
            <p className="text-xs text-muted-foreground">
              Detect → understand → predict → recommend (human decides)
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Why flagged
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                {(intel?.why_flagged ?? [`Distress: ${latest?.score ?? "—"}`]).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recommended action
              </p>
              <p className="mt-2 text-sm font-medium">{intel?.recommended_action ?? "—"}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Escalation (MVP 7d):{" "}
                <span className="font-semibold tabular-nums">
                  {intel?.escalation_risk_7d ?? latest?.escalation_risk_7d ?? "—"}
                </span>
                {" · "}
                Avg score: {intel?.average_score ?? "—"}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {intel?.disclaimer ??
                  "Triage decision-support only — not a clinical diagnosis or validated forecast."}
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Score contributions (XAI)
              </p>
              <ScoreWaterfall contributions={explain?.contributions ?? []} />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Longitudinal distress</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-muted-foreground">
                  No scores yet
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Justice stage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm capitalize text-muted-foreground">
                Current: {timeline.case.status.replace(/_/g, " ")}
              </p>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={timeline.case.status}
                onChange={(e) => updateStage(e.target.value as CaseStatus)}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Distress often shifts across complaint → investigation → trial →
                compensation → rehabilitation.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Check-ins & Reason Cards</CardTitle>
              <p className="text-xs text-muted-foreground">
                LLM rationale + signals — explainable triage, not SHAP attribution
              </p>
            </CardHeader>
            <CardContent className="max-h-96 space-y-4 overflow-y-auto">
              {timeline.checkins.map((c) => (
                <div key={c.id} className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString()} · {c.channel}
                    </span>
                    {c.distress_score && (
                      <RiskBadge
                        level={c.distress_score.risk_level}
                        score={c.distress_score.score}
                      />
                    )}
                  </div>
                  <p className="mb-2 text-muted-foreground">{c.raw_transcript}</p>
                  {c.distress_score && (
                    <>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Why
                      </p>
                      <p className="mt-1">{c.distress_score.reasoning}</p>
                      {c.distress_score.signals_detected?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(c.distress_score.signals_detected as string[]).map((s) => (
                            <span key={s} className="rounded bg-secondary px-2 py-0.5 text-xs">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommended interventions</CardTitle>
                <p className="text-xs text-muted-foreground">
                  For authorised professionals — not automated orders
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {timeline.support_recommendations.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
                  >
                    <div>
                      <span className="font-medium capitalize">{s.type.replace(/_/g, " ")}</span>
                      <p className="text-muted-foreground">{s.description}</p>
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
                ))}
                {timeline.support_recommendations.length === 0 && (
                  <p className="text-sm text-muted-foreground">No recommendations yet</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Counsellor notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {timeline.intervention_notes.map((n) => (
                    <div key={n.id} className="rounded border p-2 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                      <p>{n.note}</p>
                    </div>
                  ))}
                  {timeline.intervention_notes.length === 0 && (
                    <p className="text-sm text-muted-foreground">No notes yet</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
