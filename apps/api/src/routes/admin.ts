import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth, requireRole } from "../middleware/auth";
import crypto from "crypto";

export function adminRouter() {
  const router = Router();

  router.get("/stats", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("id, role");
      if (error) return res.status(500).json({ error: "Failed to fetch stats" });

      const list = profiles ?? [];
      const byRole = {
        victim: list.filter((p) => p.role === "victim").length,
        counsellor: list.filter((p) => p.role === "counsellor").length,
        official: list.filter((p) => p.role === "official").length,
        admin: list.filter((p) => p.role === "admin").length,
      };

      const { count: casesCount } = await supabaseAdmin
        .from("cases")
        .select("*", { count: "exact", head: true });

      const { count: openAlerts } = await supabaseAdmin
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .in("status", ["open", "acknowledged"]);

      const { count: unassignedCases } = await supabaseAdmin
        .from("cases")
        .select("*", { count: "exact", head: true })
        .is("assigned_counsellor_id", null);

      res.json({
        total_users: list.length,
        victims: byRole.victim,
        counsellors: byRole.counsellor,
        officials: byRole.official,
        admins: byRole.admin,
        cases: casesCount ?? 0,
        unassigned_cases: unassignedCases ?? 0,
        open_alerts: openAlerts ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

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

  const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    full_name: z.string().min(2),
    role: z.enum(["counsellor", "official", "victim"]),
    preferred_language: z.enum(["en", "hi", "ta"]).default("en"),
    phone_number: z.string().optional().nullable(),
  });

  /** Admin creates counsellor / official / victim accounts. */
  router.post("/users", requireAuth, requireRole("admin"), async (req, res, next) => {
    try {
      const body = createUserSchema.parse(req.body);

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: body.email.trim().toLowerCase(),
        password: body.password,
        email_confirm: true,
        user_metadata: {
          role: body.role,
          full_name: body.full_name.trim(),
          preferred_language: body.preferred_language,
          phone_number: body.phone_number ?? null,
        },
      });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      const userId = data.user!.id;
      await supabaseAdmin.from("profiles").upsert({
        id: userId,
        role: body.role,
        full_name: body.full_name.trim(),
        preferred_language: body.preferred_language,
        phone_number: body.phone_number ?? null,
      });

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      res.status(201).json(profile);
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

  router.post(
    "/onboarding-token",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    async (req, res, next) => {
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
    }
  );

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
