import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import type { RiskLevel } from "@samvedna/shared-types";

export function dashboardRouter() {
  const router = Router();

  router.get("/summary", requireAuth, requireRole("official", "admin"), async (req, res, next) => {
    try {
      let casesQuery = supabaseAdmin.from("cases").select("id, case_number, district, victim_id");

      if (req.user!.role === "official") {
        casesQuery = casesQuery.eq("assigned_official_id", req.user!.id);
      }

      const { data: cases } = await casesQuery;
      const caseIds = (cases ?? []).map((c) => c.id);

      const { data: scores } = await supabaseAdmin
        .from("distress_scores")
        .select("case_id, score, risk_level, created_at")
        .in("case_id", caseIds.length ? caseIds : ["00000000-0000-0000-0000-000000000000"])
        .order("created_at", { ascending: false });

      const latestByCase = new Map<string, { score: number; risk_level: RiskLevel }>();
      for (const s of scores ?? []) {
        if (!latestByCase.has(s.case_id)) {
          latestByCase.set(s.case_id, { score: s.score, risk_level: s.risk_level as RiskLevel });
        }
      }

      const casesByRisk: Record<RiskLevel, number> = {
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
      };

      for (const c of cases ?? []) {
        const latest = latestByCase.get(c.id);
        if (latest) casesByRisk[latest.risk_level]++;
        else casesByRisk.low++;
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

      const highRiskCases = (cases ?? [])
        .map((c) => {
          const latest = latestByCase.get(c.id);
          return {
            case_id: c.id,
            case_number: c.case_number,
            victim_name: victimMap.get(c.victim_id) ?? "Unknown",
            district: c.district,
            current_risk: latest?.risk_level ?? ("low" as RiskLevel),
            current_score: latest?.score ?? 0,
          };
        })
        .filter((c) => c.current_risk === "high" || c.current_risk === "critical")
        .sort((a, b) => b.current_score - a.current_score);

      res.json({
        total_cases: cases?.length ?? 0,
        cases_by_risk: casesByRisk,
        open_alerts: openAlerts ?? 0,
        high_risk_cases: highRiskCases,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
