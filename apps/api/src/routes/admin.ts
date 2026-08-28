import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth, requireRole } from "../middleware/auth";
import crypto from "crypto";

export function adminRouter() {
  const router = Router();

  router.get("/users", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return res.status(500).json({ error: "Failed to fetch users" });
      res.json(data ?? []);
    } catch (err) {
      next(err);
    }
  });

  const assignSchema = z.object({
    assigned_counsellor_id: z.string().uuid().optional().nullable(),
    assigned_official_id: z.string().uuid().optional().nullable(),
  });

  router.patch("/cases/:id/assign", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      const body = assignSchema.parse(req.body);
      const { data, error } = await supabaseAdmin
        .from("cases")
        .update(body)
        .eq("id", req.params.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: "Failed to update assignment" });
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  const tokenSchema = z.object({ case_id: z.string().uuid() });

  router.post("/onboarding-token", requireAuth, requireRole("counsellor", "official", "admin"), async (req, res, next) => {
    try {
      const body = tokenSchema.parse(req.body);
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { data, error } = await supabaseAdmin
        .from("onboarding_tokens")
        .insert({
          token,
          case_id: body.case_id,
          created_by: req.user!.id,
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (error) return res.status(500).json({ error: "Failed to create token" });
      res.status(201).json(data);
    } catch (err) {
      next(err);
    }
  });

  router.get("/onboarding/:token", async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("onboarding_tokens")
        .select("*, cases(case_number, case_type)")
        .eq("token", req.params.token)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (error || !data) return res.status(404).json({ error: "Invalid or expired token" });
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
