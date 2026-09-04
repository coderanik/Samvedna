"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { RiskBadge, TrendBadge } from "@/components/risk-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/utils";
import type { DashboardSummary } from "@samvedna/shared-types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Scope = "district" | "state" | "national";

export default function OfficialDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("district");
  const [role, setRole] = useState<string>("official");

  async function load(nextScope: Scope) {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("id", session.user.id)
      .single();
    setName(prof?.full_name ?? "");
    setRole(prof?.role ?? "official");

    const q = nextScope === "national" ? "national" : nextScope;
    const data = await apiFetch<DashboardSummary>(`/dashboard/summary?scope=${q}`, {
      token: session.access_token,
    });
    setSummary(data);
  }

  useEffect(() => {
    load(scope);
  }, [scope]);

  const stageData = Object.entries(summary?.cases_by_stage ?? {}).map(([stage, count]) => ({
    stage: stage.replace(/_/g, " "),
    count,
  }));
  const districtData = (summary?.cases_by_district ?? []).map((d) => ({
    name: d.district,
    cases: d.count,
    high: d.high_risk,
  }));

  return (
    <AppShell userName={name} role={role === "admin" ? "admin" : "official"}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Population intelligence</h1>
          <p className="text-sm text-muted-foreground">
            Aggregated, anonymised monitoring — district → state → national
          </p>
        </div>
        <div className="flex gap-2">
          {(["district", "state", "national"] as Scope[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={scope === s ? "default" : "outline"}
              onClick={() => setScope(s)}
              disabled={role === "official" && s !== "district"}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {!summary ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Monitored beneficiaries", value: summary.total_beneficiaries ?? summary.total_cases },
              { label: "Open alerts", value: summary.open_alerts },
              { label: "Rising risk", value: summary.rising_risk_cases ?? 0 },
              { label: "Avg distress", value: summary.average_distress ?? 0 },
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

          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            {(["low", "moderate", "high", "critical"] as const).map((level) => (
              <Card key={level}>
                <CardContent className="pt-6 text-center">
                  <RiskBadge level={level} />
                  <p className="mt-2 text-2xl font-bold">{summary.cases_by_risk[level]}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cases by justice stage</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                {stageData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stageData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={4} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">No stage data</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">District load</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                {districtData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={districtData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="cases" fill="hsl(var(--primary))" radius={4} />
                      <Bar dataKey="high" fill="#c2410c" radius={4} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">No district rows</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>High-risk & escalating cases</CardTitle>
              <Link href="/official/alerts" className="text-sm text-primary hover:underline">
                Alerts →
              </Link>
            </CardHeader>
            <CardContent>
              {summary.high_risk_cases.length === 0 ? (
                <p className="text-muted-foreground">No high-risk cases currently</p>
              ) : (
                <div className="space-y-2">
                  {summary.high_risk_cases.map((c) => (
                    <div
                      key={c.case_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div>
                        <p className="font-medium">{c.case_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {c.victim_name} · {c.district}
                          {c.state ? `, ${c.state}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <TrendBadge trend={c.trend_direction} />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          esc {c.escalation_risk_7d ?? "—"}
                        </span>
                        <RiskBadge level={c.current_risk} score={c.current_score} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}
