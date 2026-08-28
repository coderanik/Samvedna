"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { RiskBadge } from "@/components/risk-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import type { DashboardSummary } from "@samvedna/shared-types";
import { AlertTriangle, Users, BarChart3 } from "lucide-react";

export default function OfficialDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).single();
      setName(prof?.full_name ?? "");

      const data = await apiFetch<DashboardSummary>("/dashboard/summary", { token: session.access_token });
      setSummary(data);
    }
    load();
  }, []);

  return (
    <AppShell userName={name}>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">District dashboard</h1>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
          Official view
        </span>
      </div>

      {!summary ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total cases</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{summary.total_cases}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Open alerts</CardTitle>
                <AlertTriangle className="h-4 w-4 text-risk-high" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{summary.open_alerts}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">High-risk cases</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{summary.high_risk_cases.length}</p>
              </CardContent>
            </Card>
          </div>

          <div className="mb-8 grid gap-4 sm:grid-cols-4">
            {(["low", "moderate", "high", "critical"] as const).map((level) => (
              <Card key={level}>
                <CardContent className="pt-6 text-center">
                  <RiskBadge level={level} />
                  <p className="mt-2 text-2xl font-bold">{summary.cases_by_risk[level]}</p>
                  <p className="text-xs text-muted-foreground capitalize">cases</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>High-risk cases</CardTitle>
              <Link href="/official/alerts" className="text-sm text-primary hover:underline">
                View all alerts →
              </Link>
            </CardHeader>
            <CardContent>
              {summary.high_risk_cases.length === 0 ? (
                <p className="text-muted-foreground">No high-risk cases currently</p>
              ) : (
                <div className="space-y-2">
                  {summary.high_risk_cases.map((c) => (
                    <div key={c.case_id} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="font-medium">{c.case_number}</p>
                        <p className="text-sm text-muted-foreground">{c.victim_name} · {c.district}</p>
                      </div>
                      <RiskBadge level={c.current_risk} score={c.current_score} />
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
