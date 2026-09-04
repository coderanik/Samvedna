"use client";

import { useEffect, useMemo, useState } from "react";
import { RiskBadge, TrendBadge } from "@/components/risk-badge";
import { IndiaMap, type DistrictDatum } from "@/components/india-map";
import { apiFetch } from "@/lib/utils";
import type { DashboardSummary } from "@samvedna/shared-types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

type Scope = "district" | "state" | "national";

const COORDS: Record<string, { lat: number; lng: number }> = {
  Jaipur: { lat: 26.9, lng: 75.8 },
  Nagaur: { lat: 27.2, lng: 73.7 },
  Alwar: { lat: 27.55, lng: 76.63 },
  Chennai: { lat: 13.08, lng: 80.27 },
  Villupuram: { lat: 11.94, lng: 79.49 },
  Lucknow: { lat: 26.85, lng: 80.95 },
  Azamgarh: { lat: 26.07, lng: 83.18 },
  Patna: { lat: 25.6, lng: 85.14 },
  Gaya: { lat: 24.8, lng: 85.0 },
  Bhopal: { lat: 23.26, lng: 77.41 },
  Morena: { lat: 26.5, lng: 78.0 },
  Pune: { lat: 18.52, lng: 73.86 },
  Nagpur: { lat: 21.15, lng: 79.09 },
  Udaipur: { lat: 24.58, lng: 73.68 },
  "Bengaluru Urban": { lat: 12.97, lng: 77.59 },
};

/** Light-themed population intelligence used by the combined control plane. */
export function OpsIntelligence({
  token,
  role,
}: {
  token: string;
  role: string;
}) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [scope, setScope] = useState<Scope>(role === "official" ? "district" : "national");
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const nextScope = role === "official" ? "district" : scope;
        const data = await apiFetch<DashboardSummary>(`/dashboard/summary?scope=${nextScope}`, {
          token,
        });
        if (!cancelled) {
          setSummary(data);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load intelligence");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, scope, role]);

  const districts: DistrictDatum[] = useMemo(() => {
    return (summary?.cases_by_district ?? []).map((d) => {
      const c = COORDS[d.district];
      return {
        state: (d as { state?: string }).state ?? "India",
        district: d.district,
        mean_distress: d.high_risk * 12 + d.count * 4,
        lat: c?.lat,
        lng: c?.lng,
        cluster: d.high_risk >= 3,
      };
    });
  }, [summary]);

  const filteredHigh = useMemo(() => {
    const rows = summary?.high_risk_cases ?? [];
    if (!stateFilter) return rows;
    return rows.filter((c) => (c.state ?? "").toLowerCase() === stateFilter.toLowerCase());
  }, [summary, stateFilter]);

  const confidenceScatter = useMemo(() => {
    return (summary?.cases_by_district ?? []).map((d) => ({
      district: d.district,
      sla: Math.max(20, 100 - d.high_risk * 15),
      confidence: Math.max(15, 90 - d.high_risk * 12 + d.count),
    }));
  }, [summary]);

  const stageData = Object.entries(summary?.cases_by_stage ?? {}).map(([stage, count]) => ({
    stage: stage.replace(/_/g, " "),
    count,
  }));

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!summary) {
    return <p className="text-sm text-muted-foreground">Loading population intelligence…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Operations intelligence
        </p>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(["district", "state", "national"] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              disabled={role === "official" && s !== "district"}
              onClick={() => setScope(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition disabled:opacity-40 ${
                scope === s
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          {
            label: "Active cases",
            value: summary.total_beneficiaries ?? summary.total_cases,
          },
          { label: "Open alerts", value: summary.open_alerts },
          { label: "High-risk", value: summary.cases_by_risk?.high ?? 0 },
          { label: "Critical", value: summary.cases_by_risk?.critical ?? 0 },
          { label: "Rising", value: summary.rising_risk_cases ?? 0 },
          { label: "Avg distress", value: summary.average_distress ?? 0 },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border border-border bg-card px-4 py-4">
            <p className="text-3xl font-semibold tabular-nums text-foreground">{k.value}</p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {k.label}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            India overview
          </p>
          <IndiaMap districts={districts} onSelectState={setStateFilter} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Cluster markers flag districts with elevated high-risk caseloads. Positions are demo
            centroids.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Confidence vs SLA adherence
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid stroke="#e8e4dc" />
                <XAxis type="number" dataKey="sla" name="SLA" stroke="#93a19f" domain={[0, 100]} />
                <YAxis
                  type="number"
                  dataKey="confidence"
                  name="Confidence"
                  stroke="#93a19f"
                  domain={[0, 100]}
                />
                <ZAxis range={[40, 120]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #e8e4dc",
                    fontSize: 12,
                    borderRadius: 8,
                  }}
                />
                <Scatter data={confidenceScatter} fill="#0f6f65" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Justice-stage funnel
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageData}>
              <CartesianGrid stroke="#e8e4dc" strokeDasharray="3 3" />
              <XAxis dataKey="stage" tick={{ fontSize: 10, fill: "#5a6b69" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#5a6b69" }} />
              <Tooltip
                contentStyle={{
                  background: "#fff",
                  border: "1px solid #e8e4dc",
                  fontSize: 12,
                  borderRadius: 8,
                }}
              />
              <Bar dataKey="count" fill="#0f6f65" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            High-risk & escalating
            {stateFilter ? ` · ${stateFilter}` : ""}
          </p>
        </div>
        {filteredHigh.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No high-risk cases in this scope</p>
        ) : (
          <ul className="divide-y divide-border">
            {filteredHigh.map((c) => (
              <li
                key={c.case_id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-foreground">{c.case_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.victim_name} · {c.district}
                    {c.state ? `, ${c.state}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <TrendBadge trend={c.trend_direction} />
                  <span className="font-mono text-xs text-muted-foreground">
                    esc {c.escalation_risk_7d ?? "—"}
                  </span>
                  <RiskBadge level={c.current_risk} score={c.current_score} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
