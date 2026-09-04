import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import {
  computeDistressIntelligence,
  computePriorityScore,
} from "../lib/distress-intelligence";
import { getGoneQuietCases } from "../lib/cadence-engine";
import { accessibleCaseIds } from "../lib/case-access";
import { safeQuery } from "../lib/db-safe";
import type { CaseStatus, RiskLevel, TrendDirection } from "@samvedna/shared-types";

const NO_CASE = "00000000-0000-0000-0000-000000000000";

/** The POA Act journey, in order. Used by the stage funnel. */
const STAGE_ORDER: CaseStatus[] = [
  "complaint_registration",
  "investigation",
  "trial",
  "compensation",
  "rehabilitation",
  "protection_followup",
  "closed",
];

const ANOMALY_WINDOW_DAYS = 21;
const ANOMALY_Z_THRESHOLD = 1.5;

export interface DistrictAnomaly {
  district: string;
  state: string;
  z_score: number;
  slope: number;
  case_count: number;
  mean_score: number;
}

/** Least-squares slope of y over x. Returns null when x never varies. */
function linearSlope(points: Array<{ x: number; y: number }>): number | null {
  if (points.length < 3) return null;
  const n = points.length;
  const meanX = points.reduce((a, p) => a + p.x, 0) / n;
  const meanY = points.reduce((a, p) => a + p.y, 0) / n;
  const varianceX = points.reduce((a, p) => a + (p.x - meanX) ** 2, 0);
  if (varianceX === 0) return null;
  const covariance = points.reduce((a, p) => a + (p.x - meanX) * (p.y - meanY), 0);
  return covariance / varianceX;
}

/**
 * Districts whose mean distress is climbing unusually fast.
 *
 * The slope is per-district but the z-score is always against the national
 * distribution of district slopes — a district only counts as an anomaly
 * relative to the rest of the country, not to its own past.
 */
async function computeDistrictAnomalies(): Promise<DistrictAnomaly[]> {
  const { data: cases } = await safeQuery<
    Array<{ id: string; district: string | null; state: string | null }>
  >("cases:anomaly_scope", () => supabaseAdmin.from("cases").select("id, district, state"));

  if (!cases?.length) return [];

  const since = new Date(Date.now() - ANOMALY_WINDOW_DAYS * 86_400_000);
  const { data: scores } = await safeQuery<
    Array<{ case_id: string; score: number; created_at: string }>
  >("distress_scores:anomaly_window", () =>
    supabaseAdmin
      .from("distress_scores")
      .select("case_id, score, created_at")
      .gte("created_at", since.toISOString())
  );

  if (!scores?.length) return [];

  const caseMeta = new Map(cases.map((c) => [c.id, c] as const));

  const byDistrict = new Map<
    string,
    { state: string; caseIds: Set<string>; points: Array<{ x: number; y: number }> }
  >();

  for (const s of scores) {
    const meta = caseMeta.get(s.case_id);
    if (!meta?.district) continue;
    const key = `${meta.state ?? ""}||${meta.district}`;
    const entry =
      byDistrict.get(key) ??
      { state: meta.state ?? "", caseIds: new Set<string>(), points: [] };
    entry.caseIds.add(s.case_id);
    entry.points.push({
      x: (new Date(s.created_at).getTime() - since.getTime()) / 86_400_000,
      y: s.score,
    });
    byDistrict.set(key, entry);
  }

  const districts: DistrictAnomaly[] = [];
  for (const [key, entry] of byDistrict) {
    const slope = linearSlope(entry.points);
    if (slope == null) continue;
    districts.push({
      district: key.split("||")[1],
      state: entry.state,
      slope: Math.round(slope * 100) / 100,
      z_score: 0,
      case_count: entry.caseIds.size,
      mean_score: Math.round(entry.points.reduce((a, p) => a + p.y, 0) / entry.points.length),
    });
  }

  // A z-score needs a distribution to sit in; two districts is not one.
  if (districts.length < 3) return [];

  const slopes = districts.map((d) => d.slope);
  const meanSlope = slopes.reduce((a, b) => a + b, 0) / slopes.length;
  const sd = Math.sqrt(
    slopes.reduce((a, s) => a + (s - meanSlope) ** 2, 0) / (slopes.length - 1)
  );
  if (sd === 0) return [];

  return districts
    .map((d) => ({ ...d, z_score: Math.round(((d.slope - meanSlope) / sd) * 100) / 100 }))
    .filter((d) => d.z_score >= ANOMALY_Z_THRESHOLD)
    .sort((a, b) => b.z_score - a.z_score);
}

interface SlaBreachRow {
  id: string;
  case_id: string;
  type: string;
  description: string;
  status: string;
  catalog_code: string | null;
  statutory_basis: string | null;
  responsible_authority: string | null;
  sla_hours: number | null;
  due_at: string | null;
  created_at: string;
}

async function fetchSlaBreaches(caseIds: string[] | null): Promise<SlaBreachRow[]> {
  const nowIso = new Date().toISOString();

  const { data, degraded } = await safeQuery<SlaBreachRow[]>(
    "support_recommendations:sla_breaches",
    () => {
      let query = supabaseAdmin
        .from("support_recommendations")
        .select(
          "id, case_id, type, description, status, catalog_code, statutory_basis, responsible_authority, sla_hours, due_at, created_at"
        )
        .neq("status", "completed")
        .lt("due_at", nowIso)
        .order("due_at", { ascending: true })
        .limit(200);
      if (caseIds) {
        query = query.in("case_id", caseIds.length ? caseIds : [NO_CASE]);
      }
      return query;
    }
  );

  if (degraded) return [];
  return data ?? [];
}

/** Outreach response rate over the last 30 days: answered ÷ (answered + missed). */
async function fetchEngagementRate(
  caseIds: string[] | null
): Promise<{ rate: number | null; responded: number; missed: number }> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data, degraded } = await safeQuery<Array<{ status: string }>>(
    "outreach_schedule:engagement_rate",
    () => {
      let query = supabaseAdmin
        .from("outreach_schedule")
        .select("status")
        .in("status", ["responded", "missed"])
        .gte("scheduled_for", since);
      if (caseIds) {
        query = query.in("case_id", caseIds.length ? caseIds : [NO_CASE]);
      }
      return query;
    }
  );

  if (degraded || !data) return { rate: null, responded: 0, missed: 0 };

  const responded = data.filter((r) => r.status === "responded").length;
  const missed = data.filter((r) => r.status === "missed").length;
  const total = responded + missed;
  return {
    rate: total ? Math.round((responded / total) * 100) / 100 : null,
    responded,
    missed,
  };
}

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

        const scopedCaseIds =
          req.user!.role === "official" ? caseIds : await accessibleCaseIds(req.user!.role, req.user!.id);

        const [slaBreachRows, engagement, goneQuiet, allAnomalies] = await Promise.all([
          fetchSlaBreaches(scopedCaseIds),
          fetchEngagementRate(scopedCaseIds),
          getGoneQuietCases(scopedCaseIds),
          computeDistrictAnomalies(),
        ]);

        // Anomalies are computed nationally so the z-score is meaningful, then
        // narrowed to the districts this caller actually holds cases in.
        const visibleDistricts = new Set((cases ?? []).map((c) => c.district));
        const district_anomalies =
          req.user!.role === "admin" && scope === "national"
            ? allAnomalies
            : allAnomalies.filter((a) => visibleDistricts.has(a.district));

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
          sla_breaches: slaBreachRows.length,
          engagement_rate: engagement.rate,
          engagement_basis: {
            responded: engagement.responded,
            missed: engagement.missed,
            window_days: 30,
          },
          gone_quiet_count: goneQuiet.length,
          district_anomalies,
          anomaly_method: `Least-squares slope of mean distress over the last ${ANOMALY_WINDOW_DAYS} days per district, z-scored against the national distribution of district slopes; reported at z ≥ ${ANOMALY_Z_THRESHOLD}.`,
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

        // Fetch gone_quiet cases for hint annotation
        const scopedIds = req.user!.role === "admin" ? null : caseIds;
        const goneQuiet = await getGoneQuietCases(scopedIds);
        const goneQuietSet = new Set(goneQuiet.map((g) => g.id));

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
            attrition_risk: c.attrition_risk ?? null,
            gone_quiet: goneQuietSet.has(c.id),
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

  /** Statutory entitlements whose SLA clock has run out while still open. */
  router.get(
    "/sla-breaches",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    async (req, res, next) => {
      try {
        const caseIds = await accessibleCaseIds(req.user!.role, req.user!.id);
        const rows = await fetchSlaBreaches(caseIds);

        const { data: caseRows } = await safeQuery<
          Array<{ id: string; case_number: string; district: string | null; state: string | null }>
        >("cases:sla_breach_labels", () =>
          supabaseAdmin
            .from("cases")
            .select("id, case_number, district, state")
            .in("id", rows.length ? [...new Set(rows.map((r) => r.case_id))] : [NO_CASE])
        );

        const caseMap = new Map((caseRows ?? []).map((c) => [c.id, c] as const));
        const now = Date.now();

        res.json({
          total: rows.length,
          breaches: rows.map((r) => ({
            ...r,
            case_number: caseMap.get(r.case_id)?.case_number ?? null,
            district: caseMap.get(r.case_id)?.district ?? null,
            state: caseMap.get(r.case_id)?.state ?? null,
            hours_overdue: r.due_at
              ? Math.round((now - new Date(r.due_at).getTime()) / 36e5)
              : null,
          })),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /** Mean distress and case count at each stage of the POA Act journey. */
  router.get(
    "/stage-funnel",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    async (req, res, next) => {
      try {
        const scopedIds = await accessibleCaseIds(req.user!.role, req.user!.id);

        const { data: cases } = await safeQuery<Array<{ id: string; status: string }>>(
          "cases:stage_funnel",
          () => {
            let query = supabaseAdmin.from("cases").select("id, status");
            if (scopedIds) {
              query = query.in("id", scopedIds.length ? scopedIds : [NO_CASE]);
            }
            return query;
          }
        );

        const caseIds = (cases ?? []).map((c) => c.id);
        const { data: scores } = await safeQuery<
          Array<{ case_id: string; score: number; created_at: string }>
        >("distress_scores:stage_funnel", () =>
          supabaseAdmin
            .from("distress_scores")
            .select("case_id, score, created_at")
            .in("case_id", caseIds.length ? caseIds : [NO_CASE])
            .order("created_at", { ascending: false })
        );

        // One score per case: the latest, so a chatty case doesn't skew a stage.
        const latestByCase = new Map<string, number>();
        for (const s of scores ?? []) {
          if (!latestByCase.has(s.case_id)) latestByCase.set(s.case_id, s.score);
        }

        const funnel = STAGE_ORDER.map((stage) => {
          const stageCases = (cases ?? []).filter((c) => c.status === stage);
          const stageScores = stageCases
            .map((c) => latestByCase.get(c.id))
            .filter((s): s is number => s != null);

          return {
            case_status: stage,
            case_count: stageCases.length,
            scored_case_count: stageScores.length,
            mean_distress: stageScores.length
              ? Math.round(stageScores.reduce((a, b) => a + b, 0) / stageScores.length)
              : null,
          };
        });

        res.json({ funnel, order: STAGE_ORDER });
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
