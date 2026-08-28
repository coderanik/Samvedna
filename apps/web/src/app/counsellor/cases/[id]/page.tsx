"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { AlertToast } from "@/components/alert-toast";
import { RiskBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import { joinCaseRoom } from "@/lib/socket";
import type { CaseTimeline } from "@samvedna/shared-types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function CounsellorCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [timeline, setTimeline] = useState<CaseTimeline | null>(null);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadTimeline(accessToken: string) {
    const data = await apiFetch<CaseTimeline>(`/cases/${id}/timeline`, { token: accessToken });
    setTimeline(data);
  }

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      setUserId(session.user.id);
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

  if (!timeline) {
    return (
      <AppShell role="counsellor">
        <p className="text-muted-foreground">Loading case...</p>
      </AppShell>
    );
  }

  const chartData = timeline.checkins
    .filter((c) => c.distress_score)
    .map((c) => ({
      date: new Date(c.created_at).toLocaleDateString(),
      score: c.distress_score!.score,
      risk: c.distress_score!.risk_level,
    }));

  const victim = timeline.case.victim as { full_name?: string } | undefined;

  return (
    <AppShell role="counsellor" userName="">
      {userId && <AlertToast userId={userId} />}
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{timeline.case.case_number}</h1>
            <p className="text-muted-foreground">
              {victim?.full_name} · {timeline.case.case_type} · {timeline.case.district}, {timeline.case.state}
            </p>
          </div>
          {timeline.checkins.at(-1)?.distress_score && (
            <RiskBadge
              level={timeline.checkins.at(-1)!.distress_score!.risk_level}
              score={timeline.checkins.at(-1)!.distress_score!.score}
            />
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distress score timeline</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-muted-foreground">No scores yet</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Check-ins & reasoning</CardTitle>
              <p className="text-xs text-muted-foreground">
                LLM-generated rationale (PARDARSHI) — triage signal, not clinical diagnosis
              </p>
            </CardHeader>
            <CardContent className="max-h-96 space-y-4 overflow-y-auto">
              {timeline.checkins.map((c) => (
                <div key={c.id} className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                    {c.distress_score && (
                      <RiskBadge level={c.distress_score.risk_level} score={c.distress_score.score} />
                    )}
                  </div>
                  <p className="mb-2 text-muted-foreground">{c.raw_transcript}</p>
                  {c.distress_score && (
                    <>
                      <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Reasoning</p>
                      <p className="mt-1">{c.distress_score.reasoning}</p>
                      {c.distress_score.signals_detected?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(c.distress_score.signals_detected as string[]).map((s) => (
                            <span key={s} className="rounded bg-secondary px-2 py-0.5 text-xs">{s}</span>
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
                <CardTitle className="text-base">Intervention notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <form onSubmit={addNote} className="flex gap-2">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add intervention note..."
                  />
                  <Button type="submit" disabled={saving}>Add</Button>
                </form>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {timeline.intervention_notes.map((n) => (
                    <div key={n.id} className="rounded border p-2 text-sm">
                      <p className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</p>
                      <p>{n.note}</p>
                    </div>
                  ))}
                  {timeline.intervention_notes.length === 0 && (
                    <p className="text-sm text-muted-foreground">No notes yet</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recommended supports</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {timeline.support_recommendations.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <div>
                      <span className="font-medium capitalize">{s.type}</span>
                      <p className="text-muted-foreground">{s.description}</p>
                    </div>
                    <span className="text-xs capitalize text-muted-foreground">{s.status.replace("_", " ")}</span>
                  </div>
                ))}
                {timeline.support_recommendations.length === 0 && (
                  <p className="text-sm text-muted-foreground">No recommendations yet</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
