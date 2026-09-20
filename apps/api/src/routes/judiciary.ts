import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import type { Server as SocketServer } from "socket.io";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { resolvePlaybook } from "../lib/playbooks";
import { onboardInviteLinks, sendEmail } from "../lib/email";

/**
 * Judiciary / NHAA desk intake — registers case with minimal details,
 * emails invite to victim for light onboarding. Not a live government API.
 */
export function judiciaryRouter(_io: SocketServer) {
  const router = Router();

  const intakeSchema = z.object({
    victim_full_name: z.string().min(2).max(120),
    victim_email: z.string().email(),
    victim_phone: z.string().max(20).optional(),
    preferred_language: z.enum(["en", "hi", "ta"]).default("en"),
    case_number: z.string().min(3).max(64).optional(),
    judiciary_ref: z.string().max(64).optional(),
    case_type: z.enum([
      "rape",
      "gang_rape",
      "murder",
      "grievous_hurt",
      "arson",
      "witness_intimidation",
      "caste_based_violence",
      "atrocity",
      "family_violence",
      "threat",
    ]),
    district: z.string().min(2).max(80),
    state: z.string().min(2).max(80),
    intake_brief: z.string().max(2000).optional(),
    district_notify_email: z.string().email().optional(),
    official_notify_email: z.string().email().optional(),
    assign_counsellor_id: z.string().uuid().optional(),
    assign_official_id: z.string().uuid().optional(),
  });

  router.post(
    "/intake",
    requireAuth,
    requireRole("admin", "official", "counsellor"),
    async (req, res, next) => {
      try {
        const body = intakeSchema.parse(req.body);
        const playbook = resolvePlaybook(body.case_type);
        const caseNumber =
          body.case_number?.trim() ||
          `JUD-${body.district.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-8)}`;

        // Find or create placeholder victim auth user (email confirmed for demo)
        const email = body.victim_email.trim().toLowerCase();
        let victimId: string | null = null;

        const { data: listed } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
        const found = listed?.users?.find((u) => u.email?.toLowerCase() === email);
        if (found) {
          victimId = found.id;
        } else {
          const tempPassword = `Tmp-${crypto.randomBytes(6).toString("hex")}!aA1`;
          const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
              role: "victim",
              full_name: body.victim_full_name,
              preferred_language: body.preferred_language,
              phone_number: body.victim_phone ?? null,
              onboarding_required: true,
              judiciary_invited: true,
            },
          });
          if (error || !created.user) {
            return res.status(400).json({ error: error?.message ?? "Failed to create victim" });
          }
          victimId = created.user.id;
          await supabaseAdmin.from("profiles").upsert({
            id: victimId,
            role: "victim",
            full_name: body.victim_full_name,
            preferred_language: body.preferred_language,
            phone_number: body.victim_phone ?? null,
          });
        }

        const { data: existingCase } = await supabaseAdmin
          .from("cases")
          .select("id, case_number")
          .eq("case_number", caseNumber)
          .maybeSingle();

        let caseRow = existingCase;
        if (!caseRow) {
          const insertPayload: Record<string, unknown> = {
            victim_id: victimId,
            case_number: caseNumber,
            case_type: body.case_type,
            status: "complaint_registration",
            district: body.district,
            state: body.state,
            assigned_counsellor_id: body.assign_counsellor_id ?? null,
            assigned_official_id: body.assign_official_id ?? null,
          };
          // Optional sprint-1 columns — ignore if migration not applied
          insertPayload.district_notify_email = body.district_notify_email ?? null;
          insertPayload.official_notify_email = body.official_notify_email ?? null;
          insertPayload.playbook_id = playbook.id;
          insertPayload.intake_channel = "judiciary_desk";
          insertPayload.intake_brief = body.intake_brief ?? null;
          insertPayload.judiciary_ref = body.judiciary_ref ?? null;

          const { data: inserted, error } = await supabaseAdmin
            .from("cases")
            .insert(insertPayload)
            .select("id, case_number, case_type, district, state")
            .single();

          if (error || !inserted) {
            // Retry without optional columns
            const { data: basic, error: e2 } = await supabaseAdmin
              .from("cases")
              .insert({
                victim_id: victimId,
                case_number: caseNumber,
                case_type: body.case_type,
                status: "complaint_registration",
                district: body.district,
                state: body.state,
                assigned_counsellor_id: body.assign_counsellor_id ?? null,
                assigned_official_id: body.assign_official_id ?? null,
              })
              .select("id, case_number, case_type, district, state")
              .single();
            if (e2 || !basic) {
              return res.status(400).json({ error: error?.message ?? e2?.message ?? "Case create failed" });
            }
            caseRow = basic;
          } else {
            caseRow = inserted;
          }
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 14);

        const tokenPayload: Record<string, unknown> = {
          token,
          case_id: caseRow!.id,
          created_by: req.user!.id,
          expires_at: expiresAt.toISOString(),
          invite_email: email,
          invite_full_name: body.victim_full_name,
          invite_phone: body.victim_phone ?? null,
          invite_language: body.preferred_language,
          district_notify_email: body.district_notify_email ?? null,
          official_notify_email: body.official_notify_email ?? null,
        };

        let tokenRow: { token: string } | null = null;
        {
          const { data, error } = await supabaseAdmin
            .from("onboarding_tokens")
            .insert(tokenPayload)
            .select("token")
            .single();
          if (!error && data) {
            tokenRow = data;
          } else {
            const { data: basic, error: e2 } = await supabaseAdmin
              .from("onboarding_tokens")
              .insert({
                token,
                case_id: caseRow!.id,
                created_by: req.user!.id,
                expires_at: expiresAt.toISOString(),
              })
              .select("token")
              .single();
            if (e2 || !basic) {
              return res.status(500).json({ error: "Failed to create invite token" });
            }
            tokenRow = basic;
          }
        }

        const links = onboardInviteLinks(tokenRow.token);
        const link = links.web;
        const mail = await sendEmail({
          to: email,
          subject: `Samvedna — secure invite for case ${caseRow!.case_number}`,
          text: [
            `Namaste ${body.victim_full_name},`,
            "",
            "A case desk has registered your matter on Samvedna so we can support your well-being during the justice process.",
            `Case reference: ${caseRow!.case_number}`,
            `Pathway: ${playbook.label}`,
            "",
            "Complete your secure onboarding (set password + short well-being questions):",
            link,
            "",
            "On your phone with the Samvedna app installed:",
            links.app,
            "",
            "This link expires in 14 days. If you did not expect this, ignore this email.",
            "",
            "Emergency: 112 · KIRAN 1800-599-0019 · Tele-MANAS 14416 · NHAA 14566",
          ].join("\n"),
          template: "judiciary_invite",
          caseId: caseRow!.id,
        });

        await supabaseAdmin.from("case_timeline_events").insert({
          case_id: caseRow!.id,
          event_type: "judiciary_intake",
          description: `Judiciary/NHAA desk intake by ${req.user!.email}. Invite ${mail.status} to ${email}. Playbook: ${playbook.id}.`,
          created_by: req.user!.id,
        });

        res.status(201).json({
          mode: "judiciary_desk_intake",
          honesty:
            "Architected connector for judiciary / NHAA desk registration — not a live government API.",
          case: caseRow,
          playbook: { id: playbook.id, label: playbook.label },
          invite: {
            token: tokenRow.token,
            url: link,
            app_url: links.app,
            email_status: mail.status,
            expires_at: expiresAt.toISOString(),
          },
          victim_id: victimId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /** Claim invite after signup — marks token used + ensures case.victim_id */
  router.post("/claim", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const body = z.object({ token: z.string().min(16) }).parse(req.body);
      const { data: tok, error } = await supabaseAdmin
        .from("onboarding_tokens")
        .select("*")
        .eq("token", body.token)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (error || !tok) {
        return res.status(404).json({ error: "Invalid or expired invite" });
      }

      await supabaseAdmin
        .from("cases")
        .update({ victim_id: req.user!.id })
        .eq("id", tok.case_id);

      await supabaseAdmin
        .from("onboarding_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", tok.id);

      await supabaseAdmin.auth.admin.updateUserById(req.user!.id, {
        user_metadata: {
          ...(req.user?.user_metadata ?? {}),
          onboarding_required: true,
        },
      });

      res.json({
        ok: true,
        case_id: tok.case_id,
        next: "/victim/onboarding",
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
