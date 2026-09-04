import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import type { Server as SocketServer } from "socket.io";

/**
 * Simulated NHAA / Integrated Portal intake.
 * LIVE DEMO: works with service/admin auth.
 * Not a live NHAA 14566 government integration.
 */
export function intakeRouter(io: SocketServer) {
  const router = Router();

  const schema = z.object({
    complaint_id: z.string().min(3).max(64),
    full_name: z.string().min(2),
    phone_number: z.string().optional(),
    preferred_language: z.enum(["en", "hi", "ta"]).default("en"),
    case_type: z.string().min(2),
    district: z.string().min(2),
    state: z.string().min(2),
    status: z
      .enum([
        "complaint_registration",
        "investigation",
        "trial",
        "compensation",
        "rehabilitation",
        "protection_followup",
        "closed",
      ])
      .default("complaint_registration"),
    initial_message: z.string().optional(),
    channel: z
      .enum(["nhaa_14566", "portal", "helpline", "sms", "ivrs"])
      .default("nhaa_14566"),
    assign_counsellor_id: z.string().uuid().optional(),
    assign_official_id: z.string().uuid().optional(),
  });

  router.post("/nhaa", requireAuth, requireRole("admin", "official"), async (req, res, next) => {
    try {
      const body = schema.parse(req.body);
      const caseNumber = `NHAA-${body.complaint_id}`.slice(0, 40);

      // Find or create a placeholder victim auth user is heavy; link to existing victim by phone or create profile-bound case via admin path:
      // Prefer existing victim with matching phone; else require victim_email for create.
      const victimEmail = `${body.complaint_id.toLowerCase().replace(/[^a-z0-9]/g, "")}@intake.samvedna.local`;

      let victimId: string | null = null;
      const { data: listed } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      const found = listed?.users?.find((u) => u.email === victimEmail);
      if (found) {
        victimId = found.id;
      } else {
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email: victimEmail,
          password: `Intake-${body.complaint_id.slice(0, 8)}!aA1`,
          email_confirm: true,
          user_metadata: {
            role: "victim",
            full_name: body.full_name,
            preferred_language: body.preferred_language,
            phone_number: body.phone_number ?? null,
          },
        });
        if (error) return res.status(400).json({ error: error.message });
        victimId = created.user!.id;
        await supabaseAdmin.from("profiles").upsert({
          id: victimId,
          role: "victim",
          full_name: body.full_name,
          preferred_language: body.preferred_language,
          phone_number: body.phone_number ?? null,
        });
      }

      const { data: existingCase } = await supabaseAdmin
        .from("cases")
        .select("*")
        .eq("case_number", caseNumber)
        .maybeSingle();

      let caseRow = existingCase;
      if (!caseRow) {
        const { data: inserted, error } = await supabaseAdmin
          .from("cases")
          .insert({
            victim_id: victimId,
            case_number: caseNumber,
            case_type: body.case_type,
            status: body.status,
            district: body.district,
            state: body.state,
            assigned_counsellor_id: body.assign_counsellor_id ?? null,
            assigned_official_id: body.assign_official_id ?? null,
          })
          .select()
          .single();
        if (error) return res.status(400).json({ error: error.message });
        caseRow = inserted;
      }

      let scoring = null;
      if (body.initial_message?.trim()) {
        scoring = await createCheckinAndScore({
          caseId: caseRow!.id,
          victimId: victimId!,
          transcript: body.initial_message.trim(),
          channel: body.channel,
          io,
        });
      }

      res.status(201).json({
        mode: "simulated_nhaa_intake",
        honesty: "Architected connector for NHAA/Integrated Portal — not a live government API.",
        case: caseRow,
        victim_id: victimId,
        scoring,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
