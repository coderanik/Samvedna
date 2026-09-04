import { supabaseAdmin } from "./supabase";

/**
 * Auto-allot a consultant when a survivor gets their first distress score
 * and has no current assignment. Least-loaded active consultant wins.
 */
export async function maybeAllotConsultant(victimId: string): Promise<{
  allotted: boolean;
  consultant_id?: string;
  reason: string;
}> {
  const { data: existing } = await supabaseAdmin
    .from("consultant_assignments")
    .select("id, consultant_id")
    .eq("user_id", victimId)
    .maybeSingle();

  if (existing) {
    return { allotted: false, consultant_id: existing.consultant_id, reason: "already_assigned" };
  }

  const { data: cases } = await supabaseAdmin
    .from("cases")
    .select("id")
    .eq("victim_id", victimId);

  const caseIds = (cases ?? []).map((c) => c.id);
  if (!caseIds.length) {
    return { allotted: false, reason: "no_case" };
  }

  const { count: scoreCount } = await supabaseAdmin
    .from("distress_scores")
    .select("id", { count: "exact", head: true })
    .in("case_id", caseIds);

  // Allot only once the first score exists (caller invokes after insert)
  if ((scoreCount ?? 0) < 1) {
    return { allotted: false, reason: "no_scores_yet" };
  }

  const { data: consultant } = await supabaseAdmin
    .from("consultants")
    .select("id, profile_id, name, active_case_count")
    .eq("active", true)
    .order("active_case_count", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!consultant) {
    return { allotted: false, reason: "no_consultants_available" };
  }

  const { error } = await supabaseAdmin.from("consultant_assignments").insert({
    user_id: victimId,
    consultant_id: consultant.id,
  });

  if (error) {
    // Unique violation = race; treat as already assigned
    if (error.code === "23505") {
      return { allotted: false, consultant_id: consultant.id, reason: "race_already_assigned" };
    }
    console.warn("[allotment] insert failed:", error.message);
    return { allotted: false, reason: "insert_failed" };
  }

  await supabaseAdmin.from("consultant_updates").insert({
    user_id: victimId,
    consultant_id: consultant.id,
    event_type: "assigned",
    message: `${consultant.name} has been allotted as your counsellor.`,
  });

  // Keep case.assigned_counsellor_id in sync when consultant links to a profile
  if (consultant.profile_id) {
    await supabaseAdmin
      .from("cases")
      .update({ assigned_counsellor_id: consultant.profile_id })
      .eq("victim_id", victimId)
      .is("assigned_counsellor_id", null);
  }

  return { allotted: true, consultant_id: consultant.id, reason: "allotted" };
}
