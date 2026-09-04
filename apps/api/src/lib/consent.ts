import { supabaseAdmin } from "./supabase";
import { safeQuery } from "./db-safe";

export type ConsentScope =
  | "voice_recording"
  | "transcript_storage"
  | "llm_processing"
  | "family_contact"
  | "data_sharing_district"
  | "research_anonymised";

export const CONSENT_SCOPES: ConsentScope[] = [
  "voice_recording",
  "transcript_storage",
  "llm_processing",
  "family_contact",
  "data_sharing_district",
  "research_anonymised",
];

export const CONSENT_POLICY_VERSION = "2026-09-v1";

export const CONSENT_SCOPE_LABELS: Record<ConsentScope, string> = {
  voice_recording: "Record my voice during calls",
  transcript_storage: "Store what I say as text",
  llm_processing: "Use AI to help understand how I am doing",
  family_contact: "Contact my family in an emergency",
  data_sharing_district: "Share my case with district officials",
  research_anonymised: "Use my anonymised data for research",
};

export interface ConsentRecord {
  id: string;
  victim_id: string;
  scope: ConsentScope;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  policy_version: string | null;
  created_at: string;
}

export interface ConsentState {
  scope: ConsentScope;
  label: string;
  granted: boolean;
  /** False when no record exists — the permissive default is in force. */
  explicit: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  policy_version: string | null;
}

/**
 * consent_records is append-only, so the newest row per scope is authoritative.
 * No row at all means TRUE: existing demo data predates the consent table and
 * must keep working. Once a row exists we honour it, including revocations.
 */
async function latestByScope(
  victimId: string
): Promise<Map<ConsentScope, ConsentRecord> | null> {
  const { data, degraded } = await safeQuery<ConsentRecord[]>("consent_records", () =>
    supabaseAdmin
      .from("consent_records")
      .select("*")
      .eq("victim_id", victimId)
      .order("created_at", { ascending: false })
  );

  if (degraded) return null;

  const map = new Map<ConsentScope, ConsentRecord>();
  for (const row of data ?? []) {
    if (!map.has(row.scope)) map.set(row.scope, row);
  }
  return map;
}

export async function hasConsent(victimId: string, scope: ConsentScope): Promise<boolean> {
  const map = await latestByScope(victimId);
  if (!map) return true; // table missing → permissive default
  const row = map.get(scope);
  if (!row) return true; // no record → permissive default
  return row.granted === true && !row.revoked_at;
}

export async function getConsentState(victimId: string): Promise<ConsentState[]> {
  const map = await latestByScope(victimId);

  return CONSENT_SCOPES.map((scope) => {
    const row = map?.get(scope);
    return {
      scope,
      label: CONSENT_SCOPE_LABELS[scope],
      granted: row ? row.granted === true && !row.revoked_at : true,
      explicit: Boolean(row),
      granted_at: row?.granted_at ?? null,
      revoked_at: row?.revoked_at ?? null,
      policy_version: row?.policy_version ?? null,
    };
  });
}

export async function setConsent(
  victimId: string,
  scope: ConsentScope,
  granted: boolean
): Promise<ConsentRecord | null> {
  const now = new Date().toISOString();
  const { data } = await safeQuery<ConsentRecord>("consent_records:insert", () =>
    supabaseAdmin
      .from("consent_records")
      .insert({
        victim_id: victimId,
        scope,
        granted,
        granted_at: granted ? now : null,
        revoked_at: granted ? null : now,
        policy_version: CONSENT_POLICY_VERSION,
      })
      .select()
      .single()
  );
  return data;
}
