import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { canAccessCase, fetchCaseForAccess } from "../lib/case-access";
import { verifyAuditChain, type AuditRow } from "../lib/audit";
import { getRedactionStats } from "../lib/redact";
import { safeQuery } from "../lib/db-safe";

export function auditRouter() {
  const router = Router();

  /**
   * Verify the integrity of the entire audit chain.
   * Admin-only: the verification report itself is an audit event.
   */
  router.get("/verify", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const result = await verifyAuditChain();
      res.json({
        ...result,
        honesty:
          "The audit chain is a hash-chained ledger: each entry commits to its predecessor. This verification walks the entire chain.",
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Retrieve audit log entries for a specific case.
   * Staff who can access the case, or victim for their own case.
   */
  router.get("/case/:caseId", requireAuth, async (req, res, next) => {
    try {
      const caseRow = await fetchCaseForAccess(req.params.caseId);
      if (!caseRow) return res.status(404).json({ error: "Case not found" });
      if (!canAccessCase(req.user!.role, req.user!.id, caseRow)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { data, degraded } = await safeQuery<AuditRow[]>("audit_log:by_case", () =>
        supabaseAdmin
          .from("audit_log")
          .select("*")
          .eq("case_id", req.params.caseId)
          .order("created_at", { ascending: false })
          .limit(200)
      );

      if (degraded) {
        return res.json({
          audit_log: [],
          degraded: true,
          honesty: "Audit log table is not available on this database yet.",
        });
      }

      res.json({ audit_log: data ?? [], degraded: false });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Get redaction statistics: how many entities have been redacted across all transcript processing.
   * Admin-only: exposes aggregate usage telemetry.
   */
  router.get("/redaction-stats", requireAuth, requireRole("admin"), async (_req, res, next) => {
    try {
      const stats = getRedactionStats();
      res.json({
        ...stats,
        honesty:
          "These are in-process statistics counted during redactPii() calls — reset when the API process restarts.",
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
