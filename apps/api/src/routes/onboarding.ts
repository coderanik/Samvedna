import { Router } from "express";
import { z } from "zod";
import type { Server as SocketServer } from "socket.io";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { createCheckinAndScore } from "../lib/scoring-pipeline";
import {
  ensureConsultantDirectory,
  maybeAllotConsultant,
} from "../lib/consultant-allotment";
import type { RiskLevel, VictimAssignedEvent } from "@samvedna/shared-types";

const answersSchema = z.object({
  mood: z.enum(["very_low", "low", "mixed", "ok", "good"]),
  sleep: z.enum(["very_poor", "poor", "fair", "good"]),
  safety: z.enum(["unsafe", "somewhat_unsafe", "mostly_safe", "safe"]),
  energy: z.enum(["exhausted", "low", "moderate", "steady"]),
  crisis: z.enum(["no", "thoughts", "plan", "prefer_not"]),
  support_needs: z
    .array(z.enum(["counselling", "legal", "protection", "family", "medical", "financial"]))
    .min(1)
    .max(6),
  preferred_language: z.enum(["en", "hi", "ta"]).default("en"),
  notes: z.string().max(2000).optional().default(""),
});

export type OnboardingAnswers = z.infer<typeof answersSchema>;

const MOOD_LABEL: Record<OnboardingAnswers["mood"], string> = {
  very_low: "very low / overwhelmed",
  low: "low and heavy",
  mixed: "mixed — some hard days",
  ok: "mostly okay",
  good: "relatively steady",
};

const SLEEP_LABEL: Record<OnboardingAnswers["sleep"], string> = {
  very_poor: "very poor — barely sleeping",
  poor: "poor — frequent waking",
  fair: "fair",
  good: "good",
};

const SAFETY_LABEL: Record<OnboardingAnswers["safety"], string> = {
  unsafe: "I do not feel safe right now",
  somewhat_unsafe: "I feel somewhat unsafe",
  mostly_safe: "I feel mostly safe",
  safe: "I feel safe",
};

const ENERGY_LABEL: Record<OnboardingAnswers["energy"], string> = {
  exhausted: "exhausted",
  low: "low energy",
  moderate: "moderate energy",
  steady: "steady energy",
};

const CRISIS_LABEL: Record<OnboardingAnswers["crisis"], string> = {
  no: "no thoughts of harming myself",
  thoughts: "I have had thoughts of harming myself",
  plan: "I have thought about a plan to harm myself",
  prefer_not: "I prefer not to say about self-harm thoughts",
};

export function buildOnboardingTranscript(answers: OnboardingAnswers): string {
  const needs = answers.support_needs.join(", ");
  const notes = answers.notes?.trim()
    ? ` Additional note from survivor: ${answers.notes.trim()}`
    : "";
  return (
    `First-login onboarding self-report. ` +
    `Overall mood: ${MOOD_LABEL[answers.mood]}. ` +
    `Sleep: ${SLEEP_LABEL[answers.sleep]}. ` +
    `Safety: ${SAFETY_LABEL[answers.safety]}. ` +
    `Energy: ${ENERGY_LABEL[answers.energy]}. ` +
    `Crisis screen: ${CRISIS_LABEL[answers.crisis]}. ` +
    `Support requested: ${needs}. ` +
    `Preferred language: ${answers.preferred_language}.` +
    notes
  );
}

async function ensureVictimCase(victimId: string, fullName: string) {
  const { data: existing } = await supabaseAdmin
    .from("cases")
    .select("id, case_number, assigned_counsellor_id")
    .eq("victim_id", victimId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  const short = victimId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const caseNumber = `SELF-${short}`;
  const { data: inserted, error } = await supabaseAdmin
    .from("cases")
    .insert({
      victim_id: victimId,
      case_number: caseNumber,
      case_type: "atrocity_support",
      status: "complaint_registration",
      district: "Pending",
      state: "Pending",
      assigned_counsellor_id: null,
      assigned_official_id: null,
    })
    .select("id, case_number, assigned_counsellor_id")
    .single();

  if (error || !inserted) {
    const { data: again } = await supabaseAdmin
      .from("cases")
      .select("id, case_number, assigned_counsellor_id")
      .eq("victim_id", victimId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (again) return again;
    throw new Error(error?.message ?? `Failed to create case for ${fullName}`);
  }

  return inserted;
}

/** When consultants table is absent, allot the least-loaded counsellor profile. */
async function allotCounsellorProfileFallback(caseId: string): Promise<{
  profile_id: string;
  name: string;
} | null> {
  const { data: counsellors } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name")
    .eq("role", "counsellor")
    .limit(30);

  if (!counsellors?.length) return null;

  let best = counsellors[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of counsellors) {
    const { count } = await supabaseAdmin
      .from("cases")
      .select("id", { count: "exact", head: true })
      .eq("assigned_counsellor_id", c.id);
    const n = count ?? 0;
    if (n < bestCount) {
      bestCount = n;
      best = c;
    }
  }

  await supabaseAdmin
    .from("cases")
    .update({ assigned_counsellor_id: best.id })
    .eq("id", caseId);

  return { profile_id: best.id, name: best.full_name ?? "Counsellor" };
}

export function onboardingRouter(io: SocketServer) {
  const router = Router();

  router.get("/status", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const metaDone = Boolean(req.user?.user_metadata?.onboarding_completed);

      // Prefer full select; fall back if onboarding column not migrated yet
      let profile: {
        full_name?: string | null;
        preferred_language?: string | null;
        onboarding_completed_at?: string | null;
      } | null = null;

      {
        const extended = await supabaseAdmin
          .from("profiles")
          .select("onboarding_completed_at, full_name, preferred_language")
          .eq("id", userId)
          .maybeSingle();
        if (!extended.error) {
          profile = extended.data;
        } else {
          const basic = await supabaseAdmin
            .from("profiles")
            .select("full_name, preferred_language")
            .eq("id", userId)
            .maybeSingle();
          profile = basic.data;
        }
      }

      const completed =
        metaDone || Boolean(profile && "onboarding_completed_at" in profile && profile.onboarding_completed_at);

      res.json({
        completed,
        preferred_language: profile?.preferred_language ?? "en",
        full_name: profile?.full_name ?? null,
        questions: ONBOARDING_QUESTIONS,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/complete", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const answers = answersSchema.parse(req.body);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, preferred_language")
        .eq("id", userId)
        .maybeSingle();

      let alreadyCompleted = Boolean(req.user?.user_metadata?.onboarding_completed);
      {
        const withCol = await supabaseAdmin
          .from("profiles")
          .select("onboarding_completed_at")
          .eq("id", userId)
          .maybeSingle();
        if (!withCol.error && withCol.data?.onboarding_completed_at) {
          alreadyCompleted = true;
        }
      }

      if (alreadyCompleted) {
        return res.json({
          ok: true,
          already_completed: true,
          completed_at: null,
        });
      }

      const fullName = String(
        profile?.full_name ?? req.user?.user_metadata?.full_name ?? "Survivor"
      );

      await supabaseAdmin
        .from("profiles")
        .update({ preferred_language: answers.preferred_language })
        .eq("id", userId);

      try {
        await ensureConsultantDirectory();
      } catch (err) {
        console.warn(
          "[onboarding] consultant directory:",
          err instanceof Error ? err.message : err
        );
      }

      const caseRow = await ensureVictimCase(userId, fullName);

      const transcript = buildOnboardingTranscript(answers);
      const scoring = await createCheckinAndScore({
        caseId: caseRow.id,
        victimId: userId,
        transcript,
        channel: "app",
        io,
      });

      let allotment = await maybeAllotConsultant(userId).catch((err) => {
        console.warn("[onboarding] allotment:", err instanceof Error ? err.message : err);
        return {
          allotted: false as const,
          reason: "error",
          consultant_id: undefined as string | undefined,
          consultant_name: undefined as string | undefined,
          profile_id: null as string | null,
        };
      });

      let consultantName = allotment.consultant_name || "Your counsellor";
      let profileId = allotment.profile_id ?? null;
      const consultantId = allotment.consultant_id;

      if (consultantId && !profileId) {
        const { data: c } = await supabaseAdmin
          .from("consultants")
          .select("name, profile_id")
          .eq("id", consultantId)
          .maybeSingle();
        if (c) {
          consultantName = c.name;
          profileId = c.profile_id;
        }
      }

      if (!profileId) {
        const fallback = await allotCounsellorProfileFallback(caseRow.id);
        if (fallback) {
          profileId = fallback.profile_id;
          consultantName = fallback.name;
        }
      } else {
        await supabaseAdmin
          .from("cases")
          .update({ assigned_counsellor_id: profileId })
          .eq("id", caseRow.id);
      }

      const score = scoring.distressScore?.score ?? null;
      const risk = (scoring.distressScore?.risk_level ?? null) as RiskLevel | null;

      await supabaseAdmin
        .from("victim_onboarding_responses")
        .upsert(
          {
            user_id: userId,
            answers,
            transcript,
            distress_score_id: scoring.distressScore?.id ?? null,
            consultant_id: consultantId ?? null,
          },
          { onConflict: "user_id" }
        )
        .then(({ error }) => {
          if (error) console.warn("[onboarding] responses upsert:", error.message);
        });

      const completedAt = new Date().toISOString();
      {
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ onboarding_completed_at: completedAt })
          .eq("id", userId);
        if (error) console.warn("[onboarding] completed_at update:", error.message);
      }

      // Always stamp JWT metadata so the gate works before the SQL migration is applied
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...(req.user?.user_metadata ?? {}),
          onboarding_completed: true,
          onboarding_required: false,
          preferred_language: answers.preferred_language,
        },
      });

      const victimName = fullName;
      const event: VictimAssignedEvent = {
        case_id: caseRow.id,
        case_number: caseRow.case_number,
        victim_id: userId,
        victim_name: victimName,
        consultant_id: consultantId ?? profileId ?? "",
        consultant_name: consultantName,
        distress_score: score,
        risk_level: risk,
        message: `${victimName} completed onboarding. Distress score ${
          score ?? "—"
        } (${risk ?? "unknown"}). Allotted to you.`,
      };

      if (profileId) {
        io.to(`user:${profileId}`).emit("victim_assigned", event);
        io.to(`case:${caseRow.id}`).emit("victim_assigned", event);

        const severity: RiskLevel =
          risk === "critical" || risk === "high" ? (risk as RiskLevel) : "high";

        if (!scoring.alert) {
          const { data: alertRow } = await supabaseAdmin
            .from("alerts")
            .insert({
              case_id: caseRow.id,
              distress_score_id: scoring.distressScore?.id,
              severity,
              status: "open",
              assigned_to: profileId,
            })
            .select()
            .single();

          if (alertRow) {
            io.to(`user:${profileId}`).emit("new_alert", {
              alert: alertRow,
              case_id: caseRow.id,
              case_number: caseRow.case_number,
              victim_name: victimName,
              severity,
              reasoning: event.message,
              recommended_action: "Review onboarding answers and open the case.",
            });
          }
        }
      } else {
        const { data: counsellors } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("role", "counsellor")
          .limit(20);
        for (const c of counsellors ?? []) {
          io.to(`user:${c.id}`).emit("victim_assigned", event);
        }
      }

      res.status(201).json({
        ok: true,
        completed_at: completedAt,
        case: { id: caseRow.id, case_number: caseRow.case_number },
        distress_score: scoring.distressScore
          ? {
              id: scoring.distressScore.id,
              score: scoring.distressScore.score,
              risk_level: scoring.distressScore.risk_level,
            }
          : null,
        consultant: {
          id: consultantId ?? profileId,
          name: consultantName,
          profile_id: profileId,
        },
        message: `${consultantName} has been allotted to you based on your answers.`,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const ONBOARDING_QUESTIONS = [
  {
    id: "mood",
    prompt: "How have you been feeling overall this past week?",
    type: "single" as const,
    options: [
      { value: "very_low", label: "Very low / overwhelmed" },
      { value: "low", label: "Low and heavy" },
      { value: "mixed", label: "Mixed — some hard days" },
      { value: "ok", label: "Mostly okay" },
      { value: "good", label: "Relatively steady" },
    ],
  },
  {
    id: "sleep",
    prompt: "How has your sleep been?",
    type: "single" as const,
    options: [
      { value: "very_poor", label: "Very poor — barely sleeping" },
      { value: "poor", label: "Poor — frequent waking" },
      { value: "fair", label: "Fair" },
      { value: "good", label: "Good" },
    ],
  },
  {
    id: "safety",
    prompt: "How safe do you feel right now?",
    type: "single" as const,
    options: [
      { value: "unsafe", label: "I do not feel safe" },
      { value: "somewhat_unsafe", label: "Somewhat unsafe" },
      { value: "mostly_safe", label: "Mostly safe" },
      { value: "safe", label: "I feel safe" },
    ],
  },
  {
    id: "energy",
    prompt: "How is your energy day to day?",
    type: "single" as const,
    options: [
      { value: "exhausted", label: "Exhausted" },
      { value: "low", label: "Low" },
      { value: "moderate", label: "Moderate" },
      { value: "steady", label: "Steady" },
    ],
  },
  {
    id: "crisis",
    prompt: "Have you had thoughts of harming yourself?",
    type: "single" as const,
    options: [
      { value: "no", label: "No" },
      { value: "thoughts", label: "Yes — thoughts" },
      { value: "plan", label: "Yes — I have thought about a plan" },
      { value: "prefer_not", label: "Prefer not to say" },
    ],
  },
  {
    id: "support_needs",
    prompt: "What kind of support would help most right now? (pick one or more)",
    type: "multi" as const,
    options: [
      { value: "counselling", label: "Counselling / someone to talk to" },
      { value: "legal", label: "Legal guidance" },
      { value: "protection", label: "Safety / protection" },
      { value: "family", label: "Family support" },
      { value: "medical", label: "Medical care" },
      { value: "financial", label: "Financial / relief" },
    ],
  },
  {
    id: "preferred_language",
    prompt: "Which language do you prefer for support?",
    type: "single" as const,
    options: [
      { value: "en", label: "English" },
      { value: "hi", label: "Hindi" },
      { value: "ta", label: "Tamil" },
    ],
  },
  {
    id: "notes",
    prompt: "Anything else you want your counsellor to know? (optional)",
    type: "text" as const,
  },
];
