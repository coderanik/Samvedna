import { supabaseAdmin } from "./supabase";

export type AllotmentResult = {
  allotted: boolean;
  consultant_id?: string;
  consultant_name?: string;
  profile_id?: string | null;
  reason: string;
};

/**
 * Auto-allot a consultant when a survivor gets their first distress score
 * and has no current assignment. Least-loaded active consultant wins.
 */
export async function maybeAllotConsultant(victimId: string): Promise<AllotmentResult> {
  const { data: existing } = await supabaseAdmin
    .from("consultant_assignments")
    .select("id, consultant_id, consultant:consultants(id, name, profile_id)")
    .eq("user_id", victimId)
    .maybeSingle();

  if (existing) {
    const c = Array.isArray(existing.consultant)
      ? existing.consultant[0]
      : existing.consultant;
    return {
      allotted: false,
      consultant_id: existing.consultant_id,
      consultant_name: (c as { name?: string } | null)?.name,
      profile_id: (c as { profile_id?: string | null } | null)?.profile_id ?? null,
      reason: "already_assigned",
    };
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

  // Prefer matching language hint in specialization when provided via env/query — least load otherwise
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
      return {
        allotted: false,
        consultant_id: consultant.id,
        consultant_name: consultant.name,
        profile_id: consultant.profile_id,
        reason: "race_already_assigned",
      };
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

  return {
    allotted: true,
    consultant_id: consultant.id,
    consultant_name: consultant.name,
    profile_id: consultant.profile_id,
    reason: "allotted",
  };
}

/** Ensure at least one demo consultant exists (shared with consultant directory). */
export async function ensureConsultantDirectory(): Promise<void> {
  const { count } = await supabaseAdmin
    .from("consultants")
    .select("id", { count: "exact", head: true })
    .eq("active", true);
  if ((count ?? 0) > 0) return;

  const { data: counsellors } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name")
    .eq("role", "counsellor")
    .limit(5);

  const seeds = [
    {
      name: "Dr. Priya Sharma",
      specialization: "Trauma-informed counselling · Hindi/English",
      bio: "Works with atrocity survivors on sleep, anxiety, and court-related stress.",
      availability_note: "Mon–Fri 10:00–17:00 IST",
    },
    {
      name: "Dr. Ananya Iyer",
      specialization: "Clinical psychology · Tamil/English",
      bio: "Specialises in grounding work and family-system support after FIR registration.",
      availability_note: "Tue–Sat 11:00–18:00 IST",
    },
    {
      name: "Dr. Meera Nair",
      specialization: "Crisis & protection counselling",
      bio: "Coordinates with district protection officers when safety is the primary need.",
      availability_note: "Weekdays 09:30–16:30 IST",
    },
  ];

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const profileId = counsellors?.[i]?.id ?? null;
    await supabaseAdmin.from("consultants").insert({
      profile_id: profileId,
      name: s.name,
      specialization: s.specialization,
      bio: s.bio,
      availability_note: s.availability_note,
      active: true,
      active_case_count: 0,
    });
  }
}
