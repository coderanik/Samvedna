"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { RiskBadge, TrendBadge } from "@/components/risk-badge";
import { apiFetch } from "@/lib/utils";
import { IncomingCallPanel } from "@/components/incoming-call-panel";
import { CounsellorChatRequestPanel } from "@/components/counsellor-chat-request-panel";
import { GoneQuietRail, type GoneQuietItem } from "@/components/gone-quiet-rail";
import { CounsellorShell } from "@/components/counsellor-shell";
import type { PrioritisedCase } from "@samvedna/shared-types";

export default function CounsellorCasesPage() {
  const [cases, setCases] = useState<PrioritisedCase[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [token, setToken] = useState("");
  const [goneQuiet, setGoneQuiet] = useState<GoneQuietItem[]>([]);
  const [query, setQuery] = useState("");

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
      const quiet = await apiFetch<GoneQuietItem[]>("/outreach/gone-quiet", {
        token: session.access_token,
      });
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter(
      (c) =>
        c.case_number?.toLowerCase().includes(q) ||
        c.anonymised_label?.toLowerCase().includes(q) ||
        c.case_type?.toLowerCase().includes(q)
    );
  }, [cases, query]);

  return (
    <CounsellorShell
      userName={name}
      userId={userId}
      token={token}
      actions={
        userId && token ? (
          <IncomingCallPanel userId={userId} token={token} onRefresh={load} />
        ) : null
      }
    >
      {userId && token ? <CounsellorChatRequestPanel userId={userId} token={token} /> : null}
      <div className="grid gap-0 lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-[var(--sanctuary-sand)] bg-[var(--sanctuary-sand)]/25 lg:min-h-[calc(100vh-3.5rem)] lg:border-b-0 lg:border-r">
          <div className="border-b border-[var(--sanctuary-sand)] px-4 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sanctuary-teal)]">
              Gone Quiet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--sanctuary-ink-2)]">
              Disengagement is the highest-risk signal in the system.
            </p>
          </div>
          <GoneQuietRail items={goneQuiet} />
        </aside>

        <main className="px-4 py-6 sm:px-6">
          <header className="mb-6 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sanctuary-ink-3)]">
              Counsellor home
            </p>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--sanctuary-ink)] sm:text-3xl">
              Priority queue
            </h1>
            <p className="max-w-xl text-sm text-[var(--sanctuary-ink-2)]">
              Triage by distress, trend, and silence — survivors never see these scores.
            </p>
          </header>

          <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-sand)] sm:grid-cols-5">
            {[
              { label: "Critical", value: kpis.critical },
              { label: "High", value: kpis.high },
              { label: "Rising", value: kpis.rising },
              { label: "Esc ≥70", value: kpis.escalating },
              { label: "Assigned", value: kpis.total },
            ].map((k) => (
              <div key={k.label} className="bg-[var(--sanctuary-canvas)] px-4 py-3">
                <p className="font-display text-2xl tabular-nums text-[var(--sanctuary-teal)]">
                  {k.value}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                  {k.label}
                </p>
              </div>
            ))}
          </div>

          <div className="mb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cases…"
              className="w-full max-w-sm rounded-md border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] px-3 py-2 text-sm text-[var(--sanctuary-ink)] outline-none focus:border-[var(--sanctuary-teal)]"
            />
          </div>

          {loading && (
            <p className="text-sm text-[var(--sanctuary-ink-2)]">Loading queue…</p>
          )}
          {!loading && filtered.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--sanctuary-sand)] bg-[var(--sanctuary-sand)]/20 px-6 py-10 text-center">
              <p className="font-display text-lg text-[var(--sanctuary-ink)]">No cases assigned yet</p>
              <p className="mt-2 text-sm text-[var(--sanctuary-ink-2)]">
                Ask an admin to assign survivors to your caseload.
              </p>
            </div>
          )}

          <ul className="divide-y divide-[var(--sanctuary-sand)] border-y border-[var(--sanctuary-sand)]">
            {filtered.map((c) => (
              <li
                key={c.id}
                className="flex min-h-10 flex-wrap items-center gap-3 px-1 py-2 text-sm hover:bg-[var(--sanctuary-sand)]/30 sm:flex-nowrap sm:gap-4"
              >
                <span className="w-10 shrink-0 font-mono text-xs text-[var(--sanctuary-ink-3)]">
                  {c.priority_score ?? "—"}
                </span>
                <Link
                  href={`/counselor/cases/${c.id}`}
                  className="min-w-0 flex-1 truncate font-medium text-[var(--sanctuary-teal)] hover:underline"
                >
                  {c.anonymised_label ?? c.case_number}
                  <span className="ml-2 font-normal text-[var(--sanctuary-ink-3)]">
                    {c.case_number} · {c.case_type}
                  </span>
                </Link>
                <RiskBadge
                  level={c.latest_score?.risk_level ?? "low"}
                  score={c.latest_score?.score}
                />
                <TrendBadge trend={c.trend_direction} />
                <span className="hidden w-10 font-mono text-xs text-[var(--sanctuary-ink-2)] sm:inline">
                  {c.escalation_risk_7d ?? "—"}
                </span>
                {"attrition_risk" in c &&
                  (c as { attrition_risk?: number }).attrition_risk != null && (
                    <span
                      className="hidden w-8 font-mono text-xs text-[var(--sanctuary-sage)] sm:inline"
                      title="Case attrition risk"
                    >
                      A{(c as { attrition_risk?: number }).attrition_risk}
                    </span>
                  )}
                <span className="hidden max-w-[140px] truncate text-xs text-[var(--sanctuary-ink-3)] md:inline">
                  {c.recommended_action ?? "—"}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[11px] text-[var(--sanctuary-ink-3)]">
            Escalation and attrition are decision-support estimates — not clinical diagnoses. Scores
            are never shown to survivors.
          </p>
        </main>
      </div>
    </CounsellorShell>
  );
}
