"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { apiFetch } from "@/lib/utils";
import { RiskBadge } from "@/components/risk-badge";
import type { DashboardSummary } from "@samvedna/shared-types";

type GeoFilters = {
  states: string[];
  districts_by_state: Record<string, string[]>;
};

type SlaBreachPayload = {
  total: number;
  breaches: Array<{
    id: string;
    case_id: string;
    case_number: string | null;
    district: string | null;
    state: string | null;
    type: string;
    catalog_code: string | null;
    due_at: string | null;
    hours_overdue: number | null;
    responsible_authority: string | null;
  }>;
};

export default function OfficialDashboardPage() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [districtFilter, setDistrictFilter] = useState("");
  const [geo, setGeo] = useState<GeoFilters | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [sla, setSla] = useState<SlaBreachPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }
      setToken(session.access_token);
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();
      setName(prof?.full_name ?? "");
    })();
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const g = await apiFetch<GeoFilters>("/dashboard/geo-filters", { token });
        if (!cancelled) setGeo(g);
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ scope: stateFilter ? "state" : "national" });
        if (stateFilter) qs.set("state", stateFilter);
        if (districtFilter) qs.set("district", districtFilter);
        const [sum, breaches] = await Promise.all([
          apiFetch<DashboardSummary>(`/dashboard/summary?${qs}`, { token }),
          apiFetch<SlaBreachPayload>("/dashboard/sla-breaches", { token }),
        ]);
        if (!cancelled) {
          setSummary(sum);
          setSla(breaches);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, stateFilter, districtFilter]);

  const districts = useMemo(() => {
    if (!stateFilter || !geo) return [];
    return geo.districts_by_state[stateFilter] ?? [];
  }, [geo, stateFilter]);

  const filteredSla = useMemo(() => {
    const rows = sla?.breaches ?? [];
    return rows.filter((b) => {
      if (stateFilter && (b.state ?? "") !== stateFilter) return false;
      if (districtFilter && (b.district ?? "") !== districtFilter) return false;
      return true;
    });
  }, [sla, stateFilter, districtFilter]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-[var(--sanctuary-ink)]">
          District / state operations
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--sanctuary-ink-2)]">
          Filter caseload and SLA breaches by geography. Signed in as {name || "official"}.
          Population view only — survivor scores stay counsellor-private.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-[var(--sanctuary-ink-2)]">
          State
          <select
            className="ml-2 rounded-md border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] px-3 py-2 text-sm"
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setDistrictFilter("");
            }}
          >
            <option value="">All states</option>
            {(geo?.states ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-[var(--sanctuary-ink-2)]">
          District
          <select
            className="ml-2 rounded-md border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] px-3 py-2 text-sm"
            value={districtFilter}
            disabled={!stateFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
          >
            <option value="">All districts</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-[var(--sanctuary-terracotta)]">{error}</p>}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Cases in view", value: summary.total_cases },
            { label: "Open alerts", value: summary.open_alerts },
            { label: "High risk", value: summary.cases_by_risk?.high ?? 0 },
            { label: "SLA breaches", value: summary.sla_breaches ?? filteredSla.length },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-lg border border-[var(--sanctuary-sand)] px-4 py-4"
            >
              <p className="text-3xl font-semibold tabular-nums">{k.value}</p>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--sanctuary-ink-3)]">
                {k.label}
              </p>
            </div>
          ))}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-xl">High-risk cases</h2>
        <div className="space-y-2">
          {(summary?.high_risk_cases ?? []).length === 0 && (
            <p className="text-sm text-[var(--sanctuary-ink-3)]">No high-risk cases in this filter.</p>
          )}
          {(summary?.high_risk_cases ?? []).map((c) => (
            <div
              key={c.case_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--sanctuary-sand)] px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{c.case_number}</p>
                <p className="text-[var(--sanctuary-ink-3)]">
                  {c.district}, {c.state} · {c.victim_name}
                </p>
              </div>
              <RiskBadge level={c.current_risk} score={c.current_score} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl">SLA breaches</h2>
        <p className="text-sm text-[var(--sanctuary-ink-2)]">
          Statutory clocks that ran out while interventions stayed open. Breach emails go to
          counsellor + district when the cadence tick marks them.
        </p>
        <div className="space-y-2">
          {filteredSla.length === 0 && (
            <p className="text-sm text-[var(--sanctuary-ink-3)]">No open SLA breaches in view.</p>
          )}
          {filteredSla.map((b) => (
            <div
              key={b.id}
              className="rounded-lg border border-[var(--sanctuary-terracotta)]/40 px-4 py-3 text-sm"
            >
              <p className="font-medium">
                {b.case_number ?? b.case_id.slice(0, 8)} ·{" "}
                {(b.catalog_code ?? b.type).replace(/_/g, " ")}
              </p>
              <p className="text-[var(--sanctuary-ink-3)]">
                {b.district}, {b.state}
                {b.hours_overdue != null ? ` · ${b.hours_overdue}h overdue` : ""}
                {b.responsible_authority ? ` · ${b.responsible_authority}` : ""}
              </p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-[11px] text-[var(--sanctuary-ink-3)]">
        Honesty: geographic filters use Samvedna case records — not a live NHAA district API.
      </p>
    </div>
  );
}
