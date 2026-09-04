import { supabaseAdmin } from "./supabase";
import type { RiskLevel } from "@samvedna/shared-types";

export interface PoaMatch {
  code: string;
  title: string;
  statutory_basis: string;
  responsible_authority: string;
  sla_hours: number;
  support_type: string;
  description: string;
  match_rationale: string;
}

/** Match POA / MHCA catalogue entries to case signals. */
export async function recommendPoaInterventions(opts: {
  caseType: string;
  risk: RiskLevel;
  escalation: number;
  signals: string[];
}): Promise<PoaMatch[]> {
  const { data: catalog } = await supabaseAdmin
    .from("intervention_catalog")
    .select("*")
    .eq("active", true);

  if (!catalog?.length) {
    // Catalog not migrated yet — static fallback
    return staticFallback(opts);
  }

  const type = opts.caseType.toLowerCase();
  const scored = catalog
    .map((row) => {
      let score = 0;
      const reasons: string[] = [];
      const applies = (row.applies_to_case_types as string[]) ?? [];
      if (applies.some((t) => type.includes(t) || t.includes(type))) {
        score += 40;
        reasons.push(`Matches case type ${opts.caseType}`);
      }
      const min = row.min_risk_level as RiskLevel;
      const order = { low: 0, moderate: 1, high: 2, critical: 3 };
      if (order[opts.risk] >= order[min]) {
        score += 20;
        reasons.push(`Risk ${opts.risk} meets minimum ${min}`);
      }
      if (opts.escalation >= 70 && row.code.includes("CRISIS")) {
        score += 30;
        reasons.push("High escalation risk");
      }
      if (
        opts.signals.some((s) => /threat|safety|intimidation/i.test(s)) &&
        /WITNESS|PROTECT|RELOC/.test(row.code)
      ) {
        score += 25;
        reasons.push("Threat / intimidation signals");
      }
      if (
        opts.signals.some((s) => /financial|compensation|money/i.test(s)) &&
        /RELIEF|COMPENSATION|TRAVEL|financial/.test(row.code + row.support_type)
      ) {
        score += 15;
        reasons.push("Financial / relief signals");
      }
      if (opts.signals.some((s) => /medical|sleep|somatic/i.test(s)) && /MEDICAL|COUNSELLING/.test(row.code)) {
        score += 15;
        reasons.push("Health-related signals");
      }
      if (opts.risk === "critical" && row.code === "MHA_CRISIS") score += 40;

      return { row, score, reasons };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored.map(({ row, reasons }) => ({
    code: row.code,
    title: row.title,
    statutory_basis: row.statutory_basis,
    responsible_authority: row.responsible_authority,
    sla_hours: row.sla_hours,
    support_type: row.support_type,
    description: row.description,
    match_rationale: reasons.join("; "),
  }));
}

function staticFallback(opts: {
  caseType: string;
  risk: RiskLevel;
  escalation: number;
  signals: string[];
}): PoaMatch[] {
  const out: PoaMatch[] = [];
  if (opts.risk === "critical" || opts.escalation >= 75) {
    out.push({
      code: "MHA_CRISIS",
      title: "Emergency mental-health response",
      statutory_basis: "MHCA 2017; Tele-MANAS 14416",
      responsible_authority: "Tele-MANAS / DMHP",
      sla_hours: 1,
      support_type: "counselling",
      description: "Immediate crisis mental-health response.",
      match_rationale: "Critical / high escalation",
    });
  }
  out.push({
    code: "MHA_COUNSELLING",
    title: "Psychiatric / psychological care",
    statutory_basis: "Mental Healthcare Act 2017 s.18",
    responsible_authority: "DMHP / District",
    sla_hours: 48,
    support_type: "counselling",
    description: "Counselling support for authorised professionals to arrange.",
    match_rationale: "Standard care pathway",
  });
  if (opts.signals.some((s) => /threat|safety/i.test(s)) || /witness/i.test(opts.caseType)) {
    out.push({
      code: "POA_WITNESS_PROTECT",
      title: "Witness protection measures",
      statutory_basis: "Witness Protection Scheme 2018; PoA Act s.15A",
      responsible_authority: "SP / District Committee",
      sla_hours: 24,
      support_type: "witness_protection",
      description: "Protection review for intimidation / threat.",
      match_rationale: "Threat or witness case",
    });
  }
  return out.slice(0, 5);
}
