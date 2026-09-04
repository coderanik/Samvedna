import { supabaseAdmin } from "./supabase";
import type { UserRole } from "@samvedna/shared-types";

export interface CaseAccessRow {
  victim_id: string;
  assigned_counsellor_id: string | null;
  assigned_official_id: string | null;
}

export function canAccessCase(
  role: UserRole,
  userId: string,
  caseRow: CaseAccessRow
): boolean {
  if (role === "admin") return true;
  if (role === "victim") return caseRow.victim_id === userId;
  if (role === "counsellor") return caseRow.assigned_counsellor_id === userId;
  if (role === "official") return caseRow.assigned_official_id === userId;
  return false;
}

/**
 * Fetch just the assignment columns needed for an authz decision. Takes the
 * raw route param type: a malformed id simply finds no case and 404s.
 */
export async function fetchCaseForAccess(
  caseId: string | string[] | undefined
): Promise<(CaseAccessRow & { id: string; case_number: string }) | null> {
  if (!caseId || Array.isArray(caseId)) return null;
  const { data } = await supabaseAdmin
    .from("cases")
    .select("id, case_number, victim_id, assigned_counsellor_id, assigned_official_id")
    .eq("id", caseId)
    .maybeSingle();
  return (data as (CaseAccessRow & { id: string; case_number: string }) | null) ?? null;
}

/** Case ids the caller is allowed to see, or null for "everything" (admin). */
export async function accessibleCaseIds(
  role: UserRole,
  userId: string
): Promise<string[] | null> {
  if (role === "admin") return null;

  const column =
    role === "victim"
      ? "victim_id"
      : role === "counsellor"
        ? "assigned_counsellor_id"
        : "assigned_official_id";

  const { data } = await supabaseAdmin.from("cases").select("id").eq(column, userId);
  return (data ?? []).map((c) => c.id as string);
}
