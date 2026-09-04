"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { RiskBadge, TrendBadge } from "@/components/risk-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import { IncomingCallPanel } from "@/components/incoming-call-panel";
import type { PrioritisedCase } from "@samvedna/shared-types";

export default function CounsellorCasesPage() {
  const [cases, setCases] = useState<PrioritisedCase[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [token, setToken] = useState("");

  const [goneQuiet, setGoneQuiet] = useState<
    Array<{ id: string; case_number: string; missed_count: number; case_type: string }>
  >([]);

  async function load() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);
    setToken(session.access_token);
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", session.user.id)
      .single();
    setName(prof?.full_name ?? "");

    try {
      const data = await apiFetch<PrioritisedCase[]>("/dashboard/priority-queue", {
        token: session.access_token,
      });
      setCases(data);
    } catch {
      const fallback = await apiFetch<PrioritisedCase[]>("/cases", {
        token: session.access_token,
      });
      setCases(fallback);
    }

    try {
      const quiet = await apiFetch<
        Array<{ id: string; case_number: string; missed_count: number; case_type: string }>
      >("/outreach/gone-quiet", { token: session.access_token });
      setGoneQuiet(quiet);
    } catch {
      setGoneQuiet([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const kpis = useMemo(() => {
    const critical = cases.filter((c) => c.latest_score?.risk_level === "critical").length;
    const high = cases.filter((c) => c.latest_score?.risk_level === "high").length;
    const rising = cases.filter((c) => c.trend_direction === "rising").length;
    const escalating = cases.filter((c) => (c.escalation_risk_7d ?? 0) >= 70).length;
    return { critical, high, rising, escalating, total: cases.length };
  }, [cases]);

  return (
    <AppShell role="counsellor" userName={name}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Case priority queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who needs you most right now — sorted by distress, escalation risk, and case type.
          </p>
        </div>
        {userId && token ? (
          <IncomingCallPanel userId={userId} token={token} onRefresh={load} />
        ) : null}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Critical", value: kpis.critical },
          { label: "High risk", value: kpis.high },
          { label: "Rising trend", value: kpis.rising },
          { label: "Escalation ≥70", value: kpis.escalating },
          { label: "Assigned cases", value: kpis.total },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-5">
              <p className="text-3xl font-semibold tabular-nums">{k.value}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {k.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {goneQuiet.length > 0 && (
        <Card className="mb-6 border-violet-500/40 bg-violet-500/5">
          <CardHeader>
            <CardTitle className="text-base text-violet-200">Gone Quiet</CardTitle>
            <p className="text-xs text-muted-foreground">
              Missed scheduled outreach — disengagement is a clinical signal, not neutral silence.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {goneQuiet.map((c) => (
              <Link
                key={c.id}
                href={`/counselor/cases/${c.id}`}
                className="flex items-center justify-between rounded border border-violet-500/20 px-3 py-2 text-sm hover:bg-violet-500/10"
              >
                <span>
                  {c.case_number} · {c.case_type}
                </span>
                <span className="text-xs font-semibold">{c.missed_count} missed</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prioritised cases</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading && <p className="text-sm text-muted-foreground">Loading queue…</p>}
          {!loading && cases.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No assigned cases yet. Ask an admin to assign victims to you.
            </p>
          )}
          {cases.length > 0 && (
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3">Priority</th>
                  <th className="pb-2 pr-3">Victim</th>
                  <th className="pb-2 pr-3">Risk</th>
                  <th className="pb-2 pr-3">Trend</th>
                  <th className="pb-2 pr-3">Escalation</th>
                  <th className="pb-2 pr-3">Stage</th>
                  <th className="pb-2 pr-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-3 pr-3 font-semibold tabular-nums">{c.priority_score ?? "—"}</td>
                    <td className="py-3 pr-3">
                      <Link
                        href={`/counselor/cases/${c.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.anonymised_label ?? c.case_number}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.case_number} · {c.case_type}
                      </p>
                    </td>
                    <td className="py-3 pr-3">
                      <RiskBadge
                        level={c.latest_score?.risk_level ?? "low"}
                        score={c.latest_score?.score}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <TrendBadge trend={c.trend_direction} />
                    </td>
                    <td className="py-3 pr-3 tabular-nums">{c.escalation_risk_7d ?? "—"}</td>
                    <td className="py-3 pr-3 capitalize">{c.status?.replace(/_/g, " ")}</td>
                    <td className="py-3 pr-3 text-xs font-medium">{c.recommended_action ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-[11px] text-muted-foreground">
            Escalation risk is an MVP decision-support estimate (rules + LLM), not a clinically
            validated forecast.
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
