/**
 * POA Act intervention recommender.
 *
 * Matches the seeded `intervention_catalog` (13 statutory entitlements under the
 * SC/ST PoA Act 1989, its 1995 Rules, the Witness Protection Scheme 2018, the
 * Mental Healthcare Act 2017 and BNSS) against the live case signals, so a
 * counsellor is shown what this person is legally owed rather than generic
 * advice.
 */

import { supabaseAdmin } from "./supabase";
import { safeQuery, safeInsertWithFallback } from "./db-safe";
import { defaultInterventions } from "./distress-intelligence";
import type { RiskLevel, SupportType } from "@samvedna/shared-types";

export interface InterventionCatalogRow {
  id: string;
  code: string;
  support_type: string;
  title: string;
  statutory_basis: string;
  responsible_authority: string;
  sla_hours: number;
  description: string;
  eligibility_note: string | null;
  applies_to_case_types: string[] | null;
  trigger_signals: string[] | null;
  min_risk_level: RiskLevel | null;
  priority_weight: number | null;
  active: boolean;
}

export interface InterventionMatch {
  catalog_code: string;
  support_type: SupportType;
  title: string;
  statutory_basis: string;
  responsible_authority: string;
  sla_hours: number;
  description: string;
  eligibility_note: string | null;
  match_score: number;
  rationale: string;
  /** Prose the existing UI renders in the recommendation list. */
  summary: string;
}

export interface InterventionInput {
  caseId?: string;
  caseType: string;
  caseStatus: string;
  risk: RiskLevel;
  escalation: number;
  signals: string[];
  reliefOverdue?: boolean;
  reliefShortfall?: number | null;
  crisisOverride?: boolean;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, critical: 3 };

const VALID_SUPPORT_TYPES = new Set<SupportType>([
  "counselling",
  "medical",
  "legal",
  "financial",
  "protection",
  "rehabilitation",
  "relocation",
  "witness_protection",
  "follow_up",
]);

/**
 * The catalog has no case-stage column, so stage affinity lives here. Keyed by
 * catalog code because the codes are a stable, seeded contract.
 */
const STAGE_AFFINITY: Record<string, string[]> = {
  POA_RELIEF_IMMEDIATE: ["complaint_registration", "investigation"],
  POA_RELIEF_STAGED: ["investigation", "trial", "compensation"],
  POA_WITNESS_PROTECT: ["investigation", "trial"],
  POA_RELOCATION: ["rehabilitation", "protection_followup"],
  POA_LEGAL_AID: ["complaint_registration", "investigation", "trial"],
  POA_SPECIAL_PP: ["trial"],
  POA_TRAVEL_MAINT: ["trial"],
  POA_MEDICAL: ["complaint_registration", "investigation"],
  MHA_COUNSELLING: ["investigation", "trial", "rehabilitation", "protection_followup"],
  MHA_CRISIS: [],
  POA_VM_ESCALATE: ["investigation", "trial"],
  POA_ATROCITY_PRONE: ["protection_followup", "rehabilitation"],
  BNSS_COMPENSATION: ["trial", "compensation", "rehabilitation"],
};

const RELIEF_CODES = new Set([
  "POA_RELIEF_IMMEDIATE",
  "POA_RELIEF_STAGED",
  "POA_TRAVEL_MAINT",
  "BNSS_COMPENSATION",
]);

const CRISIS_CODES = new Set(["MHA_CRISIS", "POA_VM_ESCALATE"]);

// ─── catalog cache ───────────────────────────────────────────────────────────

const CATALOG_TTL_MS = 5 * 60_000;

let catalogCache: { rows: InterventionCatalogRow[] | null; fetchedAt: number } = {
  rows: null,
  fetchedAt: 0,
};

export function clearCatalogCache() {
  catalogCache = { rows: null, fetchedAt: 0 };
}

async function loadCatalog(): Promise<InterventionCatalogRow[] | null> {
  if (catalogCache.rows && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.rows;
  }

  const { data, degraded } = await safeQuery<InterventionCatalogRow[]>(
    "intervention_catalog",
    () =>
      supabaseAdmin
        .from("intervention_catalog")
        .select("*")
        .eq("active", true)
        .order("priority_weight", { ascending: false })
  );

  if (degraded || !data?.length) {
    // Cache the miss too, so a missing table doesn't mean a query per check-in.
    catalogCache = { rows: null, fetchedAt: Date.now() };
    return null;
  }

  catalogCache = { rows: data, fetchedAt: Date.now() };
  return data;
}

function normaliseSupportType(value: string): SupportType {
  const candidate = value?.toLowerCase().trim() as SupportType;
  return VALID_SUPPORT_TYPES.has(candidate) ? candidate : "counselling";
}

function tokenise(value: string): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function caseTypeMatches(caseType: string, applies: string[] | null): boolean {
  if (!applies?.length) return false;
  if (applies.includes("all") || applies.includes("*")) return true;

  const caseTokens = new Set(tokenise(caseType));
  return applies.some((entry) => {
    const entryTokens = tokenise(entry);
    if (!entryTokens.length) return false;
    return entryTokens.some((t) => caseTokens.has(t));
  });
}

function signalOverlap(signals: string[], triggers: string[] | null): string[] {
  if (!triggers?.length || !signals.length) return [];
  const signalTokens = signals.map((s) => new Set(tokenise(s)));
  return triggers.filter((trigger) => {
    const triggerTokens = tokenise(trigger);
    if (!triggerTokens.length) return false;
    return signalTokens.some((set) => triggerTokens.some((t) => set.has(t)));
  });
}

/** Catalog codes already being acted on, which must not be re-suggested. */
async function suppressedCodes(caseId: string | undefined): Promise<Set<string>> {
  if (!caseId) return new Set();

  const { data, degraded } = await safeQuery<{ catalog_code: string | null }[]>(
    "support_recommendations:suppressed",
    () =>
      supabaseAdmin
        .from("support_recommendations")
        .select("catalog_code")
        .eq("case_id", caseId)
        .in("status", ["in_progress", "completed"])
  );

  if (degraded || !data) return new Set();
  return new Set(data.map((r) => r.catalog_code).filter((c): c is string => Boolean(c)));
}

export async function recommendInterventions(
  input: InterventionInput
): Promise<InterventionMatch[]> {
  const catalog = await loadCatalog();

  if (!catalog) {
    return fallbackMatches(input);
  }

  const suppressed = await suppressedCodes(input.caseId);
  const status = (input.caseStatus ?? "").toLowerCase();

  const scored = catalog
    .filter((row) => !suppressed.has(row.code))
    .map((row) => {
      const reasons: string[] = [];
      let score = 0;

      const minRisk = row.min_risk_level ?? "low";
      if (RISK_ORDER[input.risk] < RISK_ORDER[minRisk]) {
        return { row, score: 0, reasons };
      }
      score += 15 + 8 * (RISK_ORDER[input.risk] - RISK_ORDER[minRisk]);
      reasons.push(
        `current risk ${input.risk} meets the ${minRisk} threshold for this entitlement`
      );

      if (caseTypeMatches(input.caseType, row.applies_to_case_types)) {
        score += 40;
        reasons.push(`applies to ${input.caseType.replace(/_/g, " ")} cases`);
      }

      const overlap = signalOverlap(input.signals, row.trigger_signals);
      if (overlap.length) {
        score += Math.min(50, 25 * overlap.length);
        reasons.push(`triggered by ${overlap.slice(0, 3).map((s) => s.replace(/_/g, " ")).join(", ")}`);
      }

      const stages = STAGE_AFFINITY[row.code];
      if (stages?.length && stages.includes(status)) {
        score += 12;
        reasons.push(`due at the ${status.replace(/_/g, " ")} stage`);
      }

      if (input.reliefOverdue && RELIEF_CODES.has(row.code)) {
        score += 30;
        reasons.push(
          input.reliefShortfall
            ? `₹${input.reliefShortfall.toLocaleString("en-IN")} of sanctioned relief is overdue`
            : "sanctioned relief is overdue"
        );
      }

      if ((input.escalation >= 70 || input.crisisOverride) && CRISIS_CODES.has(row.code)) {
        score += 35;
        reasons.push(
          input.crisisOverride
            ? "crisis override is active"
            : `7-day escalation risk is ${input.escalation}/100`
        );
      }

      score += Math.min(20, row.priority_weight ?? 0);

      return { row, score, reasons };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored.map(({ row, score, reasons }) => ({
    catalog_code: row.code,
    support_type: normaliseSupportType(row.support_type),
    title: row.title,
    statutory_basis: row.statutory_basis,
    responsible_authority: row.responsible_authority,
    sla_hours: row.sla_hours,
    description: row.description,
    eligibility_note: row.eligibility_note,
    match_score: score,
    rationale: `Recommended because ${reasons.join("; ")}. ${row.responsible_authority} is responsible, within ${row.sla_hours}h under ${row.statutory_basis}.`,
    summary: `${row.title} — ${row.statutory_basis} (${row.responsible_authority}, SLA ${row.sla_hours}h)`,
  }));
}

/** Catalog table absent — reuse the pre-v2 rule set so the UI still has content. */
function fallbackMatches(input: InterventionInput): InterventionMatch[] {
  return defaultInterventions(
    input.risk,
    input.escalation,
    input.signals,
    input.caseType
  ).map((rec, index) => ({
    catalog_code: `FALLBACK_${rec.type.toUpperCase()}`,
    support_type: normaliseSupportType(rec.type),
    title: rec.description,
    statutory_basis: "SC/ST (PoA) Act 1989 · Mental Healthcare Act 2017",
    responsible_authority: "District care team",
    sla_hours: input.risk === "critical" ? 24 : 72,
    description: rec.description,
    eligibility_note: null,
    match_score: 50 - index,
    rationale:
      "Intervention catalog is not available on this database yet, so this is the rule-based fallback rather than a statutory entitlement match.",
    summary: rec.description,
  }));
}

export interface PersistedRecommendation {
  catalog_code: string;
  support_type: SupportType;
  due_at: string | null;
  persisted: boolean;
}

/**
 * Write recommendations with their SLA clock started. Existing `suggested` rows
 * for the same code are left alone so a counsellor's queue doesn't churn.
 */
export async function persistRecommendations(
  caseId: string,
  matches: InterventionMatch[],
  alertId: string | null = null
): Promise<PersistedRecommendation[]> {
  const out: PersistedRecommendation[] = [];

  const { data: existing } = await safeQuery<{ catalog_code: string | null; type: string }[]>(
    "support_recommendations:existing",
    () =>
      supabaseAdmin
        .from("support_recommendations")
        .select("catalog_code, type")
        .eq("case_id", caseId)
        .eq("status", "suggested")
  );

  const existingCodes = new Set(
    (existing ?? []).map((r) => r.catalog_code).filter((c): c is string => Boolean(c))
  );
  const existingTypes = new Set((existing ?? []).map((r) => r.type));

  for (const match of matches) {
    if (existingCodes.has(match.catalog_code)) continue;
    // Without the catalog_code column we can only dedup by support type.
    if (!existingCodes.size && existingTypes.has(match.support_type)) continue;

    const dueAt = new Date(Date.now() + match.sla_hours * 3_600_000).toISOString();

    const payload: Record<string, unknown> = {
      case_id: caseId,
      alert_id: alertId,
      type: match.support_type,
      description: `${match.summary}. ${match.rationale}`,
      status: "suggested",
      catalog_code: match.catalog_code,
      statutory_basis: match.statutory_basis,
      responsible_authority: match.responsible_authority,
      sla_hours: match.sla_hours,
      due_at: dueAt,
      sla_breached: false,
      rationale: match.rationale,
    };

    const { data } = await safeInsertWithFallback<{ id: string }>(
      "support_recommendations:insert",
      payload,
      ["case_id", "alert_id", "type", "description", "status"],
      (row) => supabaseAdmin.from("support_recommendations").insert(row).select("id").single()
    );

    out.push({
      catalog_code: match.catalog_code,
      support_type: match.support_type,
      due_at: dueAt,
      persisted: Boolean(data),
    });
  }

  return out;
}

/**
 * Flip `sla_breached` on recommendations whose statutory clock ran out while
 * still open. Called from the cadence tick.
 */
export async function sweepSlaBreaches(): Promise<number> {
  const nowIso = new Date().toISOString();

  const { data, degraded } = await safeQuery<{ id: string }[]>(
    "support_recommendations:sla_sweep",
    () =>
      supabaseAdmin
        .from("support_recommendations")
        .update({ sla_breached: true })
        .lt("due_at", nowIso)
        .neq("status", "completed")
        .not("sla_breached", "is", true)
        .select("id")
  );

  if (degraded) return 0;
  return data?.length ?? 0;
}
