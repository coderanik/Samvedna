import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import {
  computeDistressIntelligence,
  computePriorityScore,
} from "../lib/distress-intelligence";
import type { RiskLevel, TrendDirection } from "@samvedna/shared-types";

export function dashboardRouter() {
  const router = Router();

  router.get(
    "/summary",
    requireAuth,
    requireRole("official", "admin"),
    async (req, res, next) => {
      try {
        const scope = (req.query.scope as string) || (req.user!.role === "admin" ? "national" : "district");
        const stateFilter = (req.query.state as string) || undefined;
        const districtFilter = (req.query.district as string) || undefined;

        let casesQuery = supabaseAdmin
          .from("cases")
          .select("id, case_number, district, state, victim_id, status, case_type");

        if (req.user!.role === "official") {
          casesQuery = casesQuery.eq("assigned_official_id", req.user!.id);
        } else if (scope === "state" && stateFilter) {
          casesQuery = casesQuery.eq("state", stateFilter);
        } else if (scope === "district" && districtFilter) {
          casesQuery = casesQuery.eq("district", districtFilter);
        }

        const { data: cases } = await casesQuery;
        const caseIds = (cases ?? []).map((c) => c.id);

        const { data: scores } = await supabaseAdmin
          .from("distress_scores")
          .select("case_id, score, risk_level, trend_direction, escalation_risk_7d, created_at")
          .in("case_id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"])
          .order("created_at", { ascending: false });

        const latestByCase = new Map<
          string,
          {
            score: number;
            risk_level: RiskLevel;
            trend_direction?: TrendDirection | null;
            escalation_risk_7d?: number | null;
          }
        >();
        for (const s of scores ?? []) {
          if (!latestByCase.has(s.case_id)) {
            latestByCase.set(s.case_id, {
              score: s.score,
              risk_level: s.risk_level as RiskLevel,
              trend_direction: s.trend_direction as TrendDirection | null,
              escalation_risk_7d: s.escalation_risk_7d,
            });
          }
        }

        const casesByRisk: Record<RiskLevel, number> = {
          low: 0,
          moderate: 0,
          high: 0,
          critical: 0,
        };
        const cases_by_stage: Record<string, number> = {};
        let rising = 0;
        let scoreSum = 0;

        for (const c of cases ?? []) {
          const latest = latestByCase.get(c.id);
          if (latest) {
            casesByRisk[latest.risk_level]++;
            scoreSum += latest.score;
            if (latest.trend_direction === "rising") rising++;
          } else {
            casesByRisk.low++;
          }
          cases_by_stage[c.status] = (cases_by_stage[c.status] ?? 0) + 1;
        }

        const { count: openAlerts } = await supabaseAdmin
          .from("alerts")
          .select("*", { count: "exact", head: true })
          .in("case_id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"])
          .in("status", ["open", "acknowledged"]);

        const victimIds = [...new Set((cases ?? []).map((c) => c.victim_id))];
        const { data: victims } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name")
          .in("id", victimIds.length ? victimIds : ["00000000-0000-0000-0000-000000000000"]);

        const victimMap = new Map((victims ?? []).map((v) => [v.id, v.full_name]));

        const districtMap = new Map<string, { count: number; high_risk: number }>();
        const stateMap = new Map<string, { count: number; high_risk: number }>();
        for (const c of cases ?? []) {
          const latest = latestByCase.get(c.id);
          const hi =
            latest && (latest.risk_level === "high" || latest.risk_level === "critical") ? 1 : 0;
          const d = districtMap.get(c.district) ?? { count: 0, high_risk: 0 };
          d.count++;
          d.high_risk += hi;
          districtMap.set(c.district, d);
          const st = stateMap.get(c.state) ?? { count: 0, high_risk: 0 };
          st.count++;
          st.high_risk += hi;
          stateMap.set(c.state, st);
        }

        const highRiskCases = (cases ?? [])
          .map((c) => {
            const latest = latestByCase.get(c.id);
            return {
              case_id: c.id,
              case_number: c.case_number,
              victim_name: anonymise(victimMap.get(c.victim_id) ?? "Unknown"),
              district: c.district,
              state: c.state,
              current_risk: latest?.risk_level ?? ("low" as RiskLevel),
              current_score: latest?.score ?? 0,
              trend_direction: latest?.trend_direction ?? null,
              escalation_risk_7d: latest?.escalation_risk_7d ?? null,
            };
          })
          .filter(
            (c) =>
              c.current_risk === "high" ||
              c.current_risk === "critical" ||
              (c.escalation_risk_7d ?? 0) >= 70
          )
          .sort(
            (a, b) =>
              (b.escalation_risk_7d ?? b.current_score) -
              (a.escalation_risk_7d ?? a.current_score)
          );

        res.json({
          total_cases: cases?.length ?? 0,
          total_beneficiaries: victimIds.length,
          cases_by_risk: casesByRisk,
          cases_by_stage,
          cases_by_district: [...districtMap.entries()].map(([district, v]) => ({
            district,
            ...v,
          })),
          cases_by_state: [...stateMap.entries()].map(([state, v]) => ({ state, ...v })),
          rising_risk_cases: rising,
          average_distress:
            cases && cases.length
              ? Math.round(scoreSum / Math.max(1, latestByCase.size))
              : 0,
          open_alerts: openAlerts ?? 0,
          high_risk_cases: highRiskCases,
          scope,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /** Prioritised case queue for counsellors / admin. */
  router.get(
    "/priority-queue",
    requireAuth,
    requireRole("counsellor", "admin", "official"),
    async (req, res, next) => {
      try {
        let query = supabaseAdmin.from("cases").select(`
          *,
          victim:profiles!cases_victim_id_fkey(id, full_name, preferred_language, phone_number),
          assigned_counsellor:profiles!cases_assigned_counsellor_id_fkey(id, full_name),
          assigned_official:profiles!cases_assigned_official_id_fkey(id, full_name)
        `);

        if (req.user!.role === "counsellor") {
          query = query.eq("assigned_counsellor_id", req.user!.id);
        } else if (req.user!.role === "official") {
          query = query.eq("assigned_official_id", req.user!.id);
        }

        const { data: cases, error } = await query;
        if (error) return res.status(500).json({ error: "Failed to fetch cases" });

        const caseIds = (cases ?? []).map((c) => c.id);
        const { data: scores } = await supabaseAdmin
          .from("distress_scores")
          .select("*")
          .in("case_id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"])
          .order("created_at", { ascending: false });

        const byCase = new Map<string, NonNullable<typeof scores>>();
        for (const s of scores ?? []) {
          const list = byCase.get(s.case_id) ?? [];
          list.push(s);
          byCase.set(s.case_id, list);
        }

        const enriched = (cases ?? []).map((c) => {
          const list = byCase.get(c.id) ?? [];
          const latest = list[0];
          const history = list.slice(1, 6).map((s) => ({
            score: s.score,
            risk_level: s.risk_level as RiskLevel,
            created_at: s.created_at,
          }));
          const intel = latest
            ? computeDistressIntelligence(
                { score: latest.score, risk_level: latest.risk_level as RiskLevel },
                history,
                (latest.signals_detected as string[]) ?? []
              )
            : null;

          const hours =
            latest != null
              ? (Date.now() - new Date(latest.created_at).getTime()) / 36e5
              : null;

          const trend = (latest?.trend_direction as TrendDirection) ?? intel?.trend_direction ?? "stable";
          const esc = latest?.escalation_risk_7d ?? intel?.escalation_risk_7d ?? 0;
          const risk = (latest?.risk_level as RiskLevel) ?? "low";

          const priority_score = computePriorityScore({
            risk,
            escalation_risk_7d: esc,
            trend,
            consecutive_elevated: intel?.consecutive_elevated ?? 0,
            case_type: c.case_type,
            hours_since_interaction: hours,
          });

          const recommended_action =
            risk === "critical" || esc >= 75
              ? "Immediate counsellor call"
              : risk === "high" || esc >= 55
                ? "Priority counselling + follow-up"
                : "Continue monitoring";

          const victim = c.victim as { full_name?: string } | null;

          return {
            ...c,
            latest_score: latest ?? null,
            priority_score,
            trend_direction: trend,
            escalation_risk_7d: esc,
            hours_since_interaction: hours != null ? Math.round(hours) : null,
            recommended_action,
            anonymised_label: anonymise(victim?.full_name ?? c.case_number),
          };
        });

        enriched.sort((a, b) => b.priority_score - a.priority_score);
        res.json(enriched);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

function anonymise(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return `${parts[0].slice(0, 1)}***`;
  return `${parts[0]} ${parts[parts.length - 1].slice(0, 1)}.`;
}
