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

      let directory: unknown[] = [];
      {
        const { data, error } = await supabaseAdmin
          .from("consultants")
          .select(
            "id, name, photo_url, specialization, bio, availability_note, active_case_count"
          )
          .eq("active", true)
          .order("name");
        if (!error && data) directory = data;
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

      res.json({
        allotted,
        pending_message: allotted
          ? null
          : "Your consultant will be assigned once your first check-in is complete.",
        directory,
        meets,
        updates,
        browse_note:
          "Browsing other consultants is informational only. Booking is with your allotted consultant.",
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
          error: "No consultant allotted yet. Complete a check-in first.",
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
          error: "No consultant allotted yet. Complete a check-in first.",
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
