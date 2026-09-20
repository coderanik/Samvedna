import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";

export function consultantRouter() {
  const router = Router();

  /** Assigned consultant + directory + meets + updates */
  router.get("/", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;

      let assignment: Record<string, unknown> | null = null;
      {
        const { data, error } = await supabaseAdmin
          .from("consultant_assignments")
          .select(
            `
            id, assigned_at, consultant_id,
            consultant:consultants(*)
          `
          )
          .eq("user_id", userId)
          .maybeSingle();
        if (!error) assignment = data;
      }

      let directory: Array<Record<string, unknown>> = [];
      {
        const { data, error } = await supabaseAdmin
          .from("consultants")
          .select(
            "id, name, photo_url, specialization, bio, availability_note, active_case_count, profile_id"
          )
          .eq("active", true)
          .order("name");
        if (!error && data?.length) {
          directory = data;
        } else {
          // Table missing or empty — ensure demo directory from counsellor profiles / fallbacks
          directory = await ensureDemoConsultants();
        }
      }

      let meets: unknown[] = [];
      {
        const { data, error } = await supabaseAdmin
          .from("consultant_meets")
          .select(
            "id, consultant_id, status, scheduled_at, report, recommendations, created_at"
          )
          .eq("user_id", userId)
          .order("scheduled_at", { ascending: false });
        if (!error && data) meets = data;
      }

      let updates: unknown[] = [];
      {
        const { data, error } = await supabaseAdmin
          .from("consultant_updates")
          .select("id, event_type, message, created_at, consultant_id, meet_id")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(40);
        if (!error && data) updates = data;
      }

      const allotted = assignment
        ? {
            assignment_id: assignment.id,
            assigned_at: assignment.assigned_at,
            consultant: Array.isArray(assignment.consultant)
              ? (assignment.consultant as unknown[])[0]
              : assignment.consultant,
          }
        : null;

      // If consultants tables aren't migrated, surface case.assigned_counsellor as allotted
      let allottedOut = allotted;
      if (!allottedOut) {
        const { data: caseRow } = await supabaseAdmin
          .from("cases")
          .select(
            "assigned_counsellor_id, assigned_counsellor:profiles!cases_assigned_counsellor_id_fkey(id, full_name)"
          )
          .eq("victim_id", userId)
          .not("assigned_counsellor_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const counsellor = Array.isArray(caseRow?.assigned_counsellor)
          ? caseRow?.assigned_counsellor[0]
          : caseRow?.assigned_counsellor;
        if (counsellor && typeof counsellor === "object" && "id" in counsellor) {
          const fromDir = directory.find((d) => d.profile_id === counsellor.id || d.id === counsellor.id);
          allottedOut = {
            assignment_id: "case-link",
            assigned_at: new Date().toISOString(),
            consultant: fromDir ?? {
              id: counsellor.id,
              name: (counsellor as { full_name?: string }).full_name ?? "Your counsellor",
              photo_url: null,
              specialization: "Trauma-informed counselling",
              bio: null,
              profile_id: counsellor.id,
            },
          };
        }
      }

      res.json({
        allotted: allottedOut,
        consultant_count: directory.length,
        pending_message: allottedOut
          ? null
          : directory.length
            ? `Choose from ${directory.length} available consultants below.`
            : "No consultants are listed yet. Ask an admin to seed the directory.",
        directory,
        meets,
        updates,
        browse_note: allottedOut
          ? "You can change your allotted consultant anytime by choosing another below."
          : "Select the consultant you feel most comfortable with. You can change later.",
        can_choose: true,
      });
    } catch (err) {
      next(err);
    }
  });

  /** Victim chooses (or switches) their consultant. */
  router.post("/choose", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const body = z.object({ consultant_id: z.string().uuid() }).parse(req.body);
      const userId = req.user!.id;

      let consultant = (
        await supabaseAdmin
          .from("consultants")
          .select("id, name, profile_id, active")
          .eq("id", body.consultant_id)
          .eq("active", true)
          .maybeSingle()
      ).data;

      // Profile-fallback directory: consultant_id may be a counsellor profile id
      let profileFallback: { id: string; name: string } | null = null;
      if (!consultant) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, role")
          .eq("id", body.consultant_id)
          .eq("role", "counsellor")
          .maybeSingle();
        if (profile) {
          profileFallback = { id: profile.id, name: profile.full_name ?? "Counsellor" };
        }
      }

      if (!consultant && !profileFallback) {
        await ensureDemoConsultants();
        const again = await supabaseAdmin
          .from("consultants")
          .select("id, name, profile_id, active")
          .eq("id", body.consultant_id)
          .eq("active", true)
          .maybeSingle();
        consultant = again.data;
      }

      if (!consultant && !profileFallback) {
        return res.status(404).json({ error: "Consultant not found" });
      }

      const profileId = consultant?.profile_id ?? profileFallback?.id ?? null;
      const displayName = consultant?.name ?? profileFallback?.name ?? "Counsellor";

      if (consultant) {
        const { data: existing } = await supabaseAdmin
          .from("consultant_assignments")
          .select("id, consultant_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (existing?.consultant_id === consultant.id) {
          return res.json({
            ok: true,
            already: true,
            consultant_id: consultant.id,
            name: consultant.name,
          });
        }

        if (existing) {
          const { error } = await supabaseAdmin
            .from("consultant_assignments")
            .update({
              consultant_id: consultant.id,
              assigned_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          if (error) return res.status(500).json({ error: "Failed to update assignment" });
        } else {
          const { error } = await supabaseAdmin.from("consultant_assignments").insert({
            user_id: userId,
            consultant_id: consultant.id,
          });
          if (error && error.code !== "23505") {
            return res.status(500).json({ error: "Failed to save choice" });
          }
        }

        await supabaseAdmin.from("consultant_updates").insert({
          user_id: userId,
          consultant_id: consultant.id,
          event_type: "assigned",
          message: `You chose ${consultant.name} as your counsellor.`,
        });

        if (!existing) {
          try {
            const { data: c } = await supabaseAdmin
              .from("consultants")
              .select("active_case_count")
              .eq("id", consultant.id)
              .maybeSingle();
            if (c) {
              await supabaseAdmin
                .from("consultants")
                .update({ active_case_count: Number(c.active_case_count ?? 0) + 1 })
                .eq("id", consultant.id);
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (profileId) {
        await supabaseAdmin
          .from("cases")
          .update({ assigned_counsellor_id: profileId })
          .eq("victim_id", userId);
      }

      res.status(201).json({
        ok: true,
        consultant_id: consultant?.id ?? profileFallback!.id,
        name: displayName,
      });
    } catch (err) {
      next(err);
    }
  });

  /** Open slots for allotted consultant */
  router.get("/slots", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const { data: assignment } = await supabaseAdmin
        .from("consultant_assignments")
        .select("consultant_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!assignment) {
        return res.status(400).json({
          error: "Choose a consultant first.",
        });
      }

      const now = new Date().toISOString();
      const { data: slots, error } = await supabaseAdmin
        .from("consultant_slots")
        .select("id, starts_at, ends_at")
        .eq("consultant_id", assignment.consultant_id)
        .eq("is_booked", false)
        .gte("starts_at", now)
        .order("starts_at", { ascending: true })
        .limit(40);

      if (error) return res.status(500).json({ error: "Failed to load slots" });
      res.json(slots ?? []);
    } catch (err) {
      next(err);
    }
  });

  /** Book a session with allotted consultant */
  router.post("/book", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const body = z
        .object({
          slot_id: z.string().uuid().optional(),
          scheduled_at: z.string().datetime().optional(),
        })
        .parse(req.body);

      const userId = req.user!.id;

      const { data: assignment } = await supabaseAdmin
        .from("consultant_assignments")
        .select("consultant_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!assignment) {
        return res.status(400).json({
          error: "Choose a consultant first.",
        });
      }

      let scheduledAt = body.scheduled_at;
      let slotId = body.slot_id;

      if (slotId) {
        const { data: slot } = await supabaseAdmin
          .from("consultant_slots")
          .select("*")
          .eq("id", slotId)
          .eq("consultant_id", assignment.consultant_id)
          .eq("is_booked", false)
          .maybeSingle();

        if (!slot) return res.status(404).json({ error: "Slot unavailable" });
        scheduledAt = slot.starts_at;
      }

      if (!scheduledAt) {
        return res.status(400).json({ error: "Provide slot_id or scheduled_at" });
      }

      const { data: meet, error } = await supabaseAdmin
        .from("consultant_meets")
        .insert({
          user_id: userId,
          consultant_id: assignment.consultant_id,
          status: "scheduled",
          scheduled_at: scheduledAt,
        })
        .select()
        .single();

      if (error || !meet) return res.status(500).json({ error: "Failed to book session" });

      if (slotId) {
        await supabaseAdmin
          .from("consultant_slots")
          .update({ is_booked: true, meet_id: meet.id })
          .eq("id", slotId);
      }

      await supabaseAdmin.from("consultant_updates").insert({
        user_id: userId,
        consultant_id: assignment.consultant_id,
        meet_id: meet.id,
        event_type: "booking_confirmed",
        message: `Session booked for ${new Date(scheduledAt).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
        })}.`,
      });

      res.status(201).json(meet);
    } catch (err) {
      next(err);
    }
  });

  router.post("/:meetId/cancel", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const { data: meet } = await supabaseAdmin
        .from("consultant_meets")
        .select("*")
        .eq("id", req.params.meetId)
        .single();

      if (!meet) return res.status(404).json({ error: "Meeting not found" });
      if (meet.user_id !== userId) return res.status(403).json({ error: "Access denied" });

      const { data: updated, error } = await supabaseAdmin
        .from("consultant_meets")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", meet.id)
        .select()
        .single();

      if (error) return res.status(500).json({ error: "Failed to cancel" });

      await supabaseAdmin
        .from("consultant_slots")
        .update({ is_booked: false, meet_id: null })
        .eq("meet_id", meet.id);

      await supabaseAdmin.from("consultant_updates").insert({
        user_id: userId,
        consultant_id: meet.consultant_id,
        meet_id: meet.id,
        event_type: "cancelled",
        message: "A scheduled session was cancelled.",
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

const DEMO_CONSULTANTS = [
  {
    name: "Dr. Priya Sharma",
    specialization: "Trauma-informed counselling · Hindi/English",
    bio: "Works with atrocity survivors on sleep, anxiety, and court-related stress.",
    availability_note: "Mon–Fri 10:00–17:00 IST",
    email: "counsellor1@samvedna.demo",
  },
  {
    name: "Dr. Ananya Iyer",
    specialization: "Clinical psychology · Tamil/English",
    bio: "Specialises in grounding work and family-system support after FIR registration.",
    availability_note: "Tue–Sat 11:00–18:00 IST",
    email: "counsellor2@samvedna.demo",
  },
  {
    name: "Dr. Meera Nair",
    specialization: "Crisis & protection counselling",
    bio: "Coordinates with district protection officers when safety is the primary need.",
    availability_note: "Weekdays 09:30–16:30 IST",
    email: "counsellor3@samvedna.demo",
  },
];

/** Insert demo consultants when the directory table is empty / missing seed. */
async function ensureDemoConsultants(): Promise<Array<Record<string, unknown>>> {
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("consultants")
    .select(
      "id, name, photo_url, specialization, bio, availability_note, active_case_count, profile_id"
    )
    .eq("active", true)
    .order("name");

  if (!existingErr && existing?.length) return existing;

  const { data: counsellors } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name")
    .eq("role", "counsellor")
    .limit(10);

  const counsellorList = counsellors ?? [];

  // Table missing — expose live counsellor profiles so victims can still choose
  if (existingErr) {
    console.warn("[consultant] directory table unavailable:", existingErr.message);
    return counsellorList.map((p, i) => {
      const seed = DEMO_CONSULTANTS[i] ?? DEMO_CONSULTANTS[0];
      return {
        id: p.id,
        name: p.full_name ?? seed.name,
        photo_url: null,
        specialization: seed.specialization,
        bio: seed.bio,
        availability_note: seed.availability_note,
        active_case_count: 0,
        profile_id: p.id,
        _from_profile: true,
      };
    });
  }

  const created: Array<Record<string, unknown>> = [];

  for (const cs of DEMO_CONSULTANTS) {
    const lastName = cs.name.split(" ").slice(-1)[0]?.toLowerCase() ?? "";
    const match = counsellorList.find((p) =>
      (p.full_name ?? "").toLowerCase().includes(lastName)
    );
    const profileId = match?.id ?? counsellorList[created.length]?.id ?? null;

    const { data: inserted, error } = await supabaseAdmin
      .from("consultants")
      .insert({
        profile_id: profileId,
        name: cs.name,
        specialization: cs.specialization,
        bio: cs.bio,
        availability_note: cs.availability_note,
        active: true,
        active_case_count: 0,
      })
      .select(
        "id, name, photo_url, specialization, bio, availability_note, active_case_count, profile_id"
      )
      .single();

    if (!error && inserted) {
      created.push(inserted);
    } else if (error) {
      console.warn("[consultant] demo seed failed:", error.message);
    }
  }

  const { data: refreshed } = await supabaseAdmin
    .from("consultants")
    .select(
      "id, name, photo_url, specialization, bio, availability_note, active_case_count, profile_id"
    )
    .eq("active", true)
    .order("name");

  if (refreshed?.length) return refreshed;
  if (created.length) return created;

  // Last resort: profile directory
  return counsellorList.map((p, i) => {
    const seed = DEMO_CONSULTANTS[i] ?? DEMO_CONSULTANTS[0];
    return {
      id: p.id,
      name: p.full_name ?? seed.name,
      photo_url: null,
      specialization: seed.specialization,
      bio: seed.bio,
      availability_note: seed.availability_note,
      active_case_count: 0,
      profile_id: p.id,
      _from_profile: true,
    };
  });
}
