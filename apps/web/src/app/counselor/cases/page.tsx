"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { RiskBadge, TrendBadge } from "@/components/risk-badge";
import { apiFetch } from "@/lib/utils";
import { IncomingCallPanel } from "@/components/incoming-call-panel";
import { GoneQuietRail, type GoneQuietItem } from "@/components/gone-quiet-rail";
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

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="theme-command min-h-screen">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <div>
          <p className="label-caps">Counsellor command</p>
          <h1 className="font-mono text-lg text-cyan">Priority queue</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-cmd">{name}</span>
          {userId && token ? (
            <IncomingCallPanel userId={userId} token={token} onRefresh={load} />
          ) : null}
          <button type="button" onClick={logout} className="text-xs text-faint underline">
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-0 lg:grid-cols-[240px_1fr]">
        <aside className="border-r border-hairline bg-elevated">
          <div className="border-b border-hairline px-3 py-3">
            <p className="label-caps text-violet">Gone Quiet</p>
            <p className="mt-1 text-[11px] text-faint">
              Disengagement is the highest-risk signal in the system.
            </p>
          </div>
          <GoneQuietRail items={goneQuiet} />
        </aside>

        <main className="px-6 py-6">
          <div className="mb-6 grid grid-cols-2 gap-px bg-hairline sm:grid-cols-5">
            {[
              { label: "Critical", value: kpis.critical },
              { label: "High", value: kpis.high },
              { label: "Rising", value: kpis.rising },
              { label: "Esc ≥70", value: kpis.escalating },
              { label: "Assigned", value: kpis.total },
            ].map((k) => (
              <div key={k.label} className="bg-elevated px-4 py-3">
                <p className="font-mono text-2xl text-cyan">{k.value}</p>
                <p className="label-caps mt-1">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="mb-4 flex items-center gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cases…  /"
              className="w-full max-w-sm border border-hairline bg-raised px-3 py-2 font-mono text-sm text-ink outline-none focus:border-cyan"
            />
          </div>

          {loading && <p className="text-sm text-muted-cmd">Loading queue…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-muted-cmd">
              No assigned cases yet. Ask an admin to assign survivors to you.
            </p>
          )}

          <ul className="divide-y divide-hairline border-y border-hairline">
            {filtered.map((c) => (
              <li key={c.id} className="flex h-8 items-center gap-4 px-1 text-sm hover:bg-raised">
                <span className="w-10 shrink-0 font-mono text-faint">
                  {c.priority_score ?? "—"}
                </span>
                <Link
                  href={`/counselor/cases/${c.id}`}
                  className="min-w-0 flex-1 truncate font-mono text-cyan hover:underline"
                >
                  {c.anonymised_label ?? c.case_number}
                  <span className="ml-2 text-faint">
                    {c.case_number} · {c.case_type}
                  </span>
                </Link>
                <RiskBadge
                  level={c.latest_score?.risk_level ?? "low"}
                  score={c.latest_score?.score}
                />
                <TrendBadge trend={c.trend_direction} />
                <span className="hidden w-10 font-mono text-xs text-muted-cmd sm:inline">
                  {c.escalation_risk_7d ?? "—"}
                </span>
                {"attrition_risk" in c && (c as { attrition_risk?: number }).attrition_risk != null && (
                  <span
                    className="hidden w-8 font-mono text-xs text-violet sm:inline"
                    title="Case attrition risk"
                  >
                    A{(c as { attrition_risk?: number }).attrition_risk}
                  </span>
                )}
                <span className="hidden max-w-[140px] truncate text-xs text-faint md:inline">
                  {c.recommended_action ?? "—"}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[11px] text-faint">
            Escalation and attrition are decision-support estimates — not clinical diagnoses. Scores
            are never shown to survivors.
          </p>
        </main>
      </div>
    </div>
  );
}
