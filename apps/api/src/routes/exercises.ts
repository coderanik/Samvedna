import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";

const FALLBACK_EXERCISES = [
  {
    id: "fallback-general",
    tag: "general",
    title: "Daily steadiness check",
    description: "A brief wellness plan when chat themes are still forming.",
    steps: [
      "Rate energy, mood, and sleep from 1–5 privately.",
      "Do 3 rounds of slow breathing.",
      "Drink water and eat something simple.",
      "Note one support you used today.",
      "Reach out if today feels heavier than usual.",
    ],
    content_url: null,
    duration_minutes: 7,
  },
  {
    id: "fallback-anxiety",
    tag: "anxiety",
    title: "Box breathing",
    description: "A simple 4-count breath that calms the nervous system when worry spikes.",
    steps: [
      "Sit comfortably with both feet on the floor.",
      "Inhale through the nose for 4 counts.",
      "Hold gently for 4 counts.",
      "Exhale through the mouth for 4 counts.",
      "Hold empty for 4 counts. Repeat 4–6 rounds.",
    ],
    content_url: null,
    duration_minutes: 5,
  },
];

export function exercisesRouter() {
  const router = Router();

  router.get("/", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const userId = req.user!.id;

      let tags: Array<{ tag: string; last_seen_at?: string }> = [];
      {
        const { data, error } = await supabaseAdmin
          .from("user_problem_tags")
          .select("tag, last_seen_at")
          .eq("user_id", userId)
          .order("last_seen_at", { ascending: false });
        if (!error && data) tags = data;
      }

      const tagList = tags.map((t) => t.tag);
      const queryTags = tagList.length ? tagList : ["general", "anxiety"];

      let items: unknown[] = [];
      {
        const { data, error } = await supabaseAdmin
          .from("exercise_recommendations")
          .select("id, tag, title, description, steps, content_url, duration_minutes")
          .in("tag", queryTags)
          .eq("active", true)
          .limit(12);
        if (!error && data?.length) items = data;
      }

      if (!items.length) {
        items = FALLBACK_EXERCISES.filter(
          (e) => queryTags.includes(e.tag) || e.tag === "general"
        );
      }

      res.json({
        tags,
        recommendations: items,
        logic: "tag → exercise_recommendations mapping (explainable v1)",
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      const fallback = FALLBACK_EXERCISES.find((e) => e.id === req.params.id);
      if (fallback) return res.json(fallback);

      const { data, error } = await supabaseAdmin
        .from("exercise_recommendations")
        .select("*")
        .eq("id", req.params.id)
        .eq("active", true)
        .maybeSingle();

      if (error || !data) return res.status(404).json({ error: "Exercise not found" });
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
