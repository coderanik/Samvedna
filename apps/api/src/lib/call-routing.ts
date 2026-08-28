import { supabaseAdmin } from "./supabase";
import { normalizePhone } from "./phone";
import type { RiskLevel } from "@samvedna/shared-types";

export function routeCallType(riskLevel: RiskLevel): "counsellor" | "ai_voice" {
  return riskLevel === "high" || riskLevel === "critical" ? "counsellor" : "ai_voice";
}

export async function getLatestRisk(caseId: string): Promise<{ risk_level: RiskLevel; score: number | null }> {
  const { data } = await supabaseAdmin
    .from("distress_scores")
    .select("risk_level, score")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return {
    risk_level: (data?.risk_level as RiskLevel) ?? "low",
    score: data?.score ?? null,
  };
}

export interface VictimContext {
  id: string;
  full_name: string;
  phone_number: string | null;
  preferred_language: string;
  case_id: string;
  case_number: string;
  assigned_counsellor_id: string | null;
  counsellor_phone: string | null;
  counsellor_name: string | null;
}

/** Lookup registered victim by inbound phone number. */
export async function lookupVictimByPhone(callerPhone: string): Promise<VictimContext | null> {
  const phone10 = normalizePhone(callerPhone);
  if (phone10.length < 10) return null;

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, phone_number, preferred_language")
    .eq("role", "victim");

  const victim = (profiles ?? []).find(
    (p) => p.phone_number && normalizePhone(p.phone_number) === phone10
  );
  if (!victim) return null;

  const { data: caseRow } = await supabaseAdmin
    .from("cases")
    .select(`
      id, case_number, assigned_counsellor_id,
      counsellor:profiles!cases_assigned_counsellor_id_fkey(full_name, phone_number)
    `)
    .eq("victim_id", victim.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!caseRow) return null;

  const counsellorRaw = caseRow.counsellor;
  const counsellor = (Array.isArray(counsellorRaw) ? counsellorRaw[0] : counsellorRaw) as {
    full_name: string;
    phone_number: string | null;
  } | null;

  return {
    id: victim.id,
    full_name: victim.full_name,
    phone_number: victim.phone_number,
    preferred_language: victim.preferred_language ?? "en",
    case_id: caseRow.id,
    case_number: caseRow.case_number,
    assigned_counsellor_id: caseRow.assigned_counsellor_id,
    counsellor_phone: counsellor?.phone_number ?? null,
    counsellor_name: counsellor?.full_name ?? null,
  };
}
