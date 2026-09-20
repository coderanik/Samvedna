import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { registerPushToken } from "../lib/push";

export function victimMobileRouter() {
  const router = Router();

  /** Register Expo push token for this victim. */
  router.post(
    "/push-token",
    requireAuth,
    requireRole("victim"),
    async (req, res, next) => {
      try {
        const body = z
          .object({
            token: z.string().min(20).max(500),
            platform: z.string().max(32).optional(),
            app_version: z.string().max(32).optional(),
          })
          .parse(req.body);

        const result = await registerPushToken({
          userId: req.user!.id,
          token: body.token,
          platform: body.platform,
          appVersion: body.app_version,
        });

        if (!result.ok) {
          return res.status(400).json({ error: result.error });
        }
        res.json({
          ok: true,
          honesty: "Push uses Expo Push API. Requires physical device or Expo Go.",
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /** Next upcoming counselling session for Home Join CTA. */
  router.get(
    "/counselling/next",
    requireAuth,
    requireRole("victim"),
    async (req, res, next) => {
      try {
        const now = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("counselling_sessions")
          .select(
            "id, case_id, scheduled_at, duration_minutes, status, video_room_url, counsellor_id"
          )
          .eq("victim_id", req.user!.id)
          .in("status", ["scheduled", "reminded"])
          .gte("scheduled_at", new Date(Date.now() - 30 * 60_000).toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (error) {
          // Table may be missing on undeployed migrations
          console.warn("[counselling/next]", error.message);
          return res.json({
            session: null,
            honesty: "Counselling sessions table unavailable until migration applied.",
          });
        }

        let counsellorName: string | null = null;
        if (data?.counsellor_id) {
          const { data: prof } = await supabaseAdmin
            .from("profiles")
            .select("full_name")
            .eq("id", data.counsellor_id)
            .maybeSingle();
          counsellorName = prof?.full_name ?? null;
        }

        const scheduledAt = data?.scheduled_at ? new Date(data.scheduled_at).getTime() : 0;
        const windowMs = (data?.duration_minutes ?? 60) * 60_000;
        const joinable =
          Boolean(data) &&
          Date.now() >= scheduledAt - 15 * 60_000 &&
          Date.now() <= scheduledAt + windowMs;

        res.json({
          session: data
            ? {
                ...data,
                counsellor_name: counsellorName,
                joinable,
                starts_in_minutes: Math.round((scheduledAt - Date.now()) / 60_000),
              }
            : null,
          now,
          honesty:
            "Sessions are scheduled by Samvedna when distress is high/critical — not a live NHAA calendar.",
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
