import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { canAccessCase, fetchCaseForAccess } from "../lib/case-access";
import { recordAudit } from "../lib/audit";
import {
  getConsentState,
  setConsent,
  CONSENT_POLICY_VERSION,
  CONSENT_SCOPES,
  type ConsentScope,
} from "../lib/consent";

const DEFAULT_NOTE =
  "consent_records is append-only. No row means TRUE (permissive default), so data captured before the register existed keeps working. Once a row exists, the newest grant/revoke for each scope is authoritative.";

export function consentRouter() {
  const router = Router();

  const setScopeSchema = z.object({ granted: z.boolean() });

  function parseScope(raw: unknown): ConsentScope | null {
    const scope = String(raw) as ConsentScope;
    return CONSENT_SCOPES.includes(scope) ? scope : null;
  }

  async function readOwn(userId: string) {
    return {
      victim_id: userId,
      policy_version: CONSENT_POLICY_VERSION,
      consent_state: await getConsentState(userId),
      honesty: DEFAULT_NOTE,
    };
  }

  /** A person's own consent register. */
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      res.json(await readOwn(req.user!.id));
    } catch (err) {
      next(err);
    }
  });

  /** Same payload under an explicit path, for clients that prefer it. */
  router.get("/me", requireAuth, async (req, res, next) => {
    try {
      if (req.user!.role !== "victim") {
        return res.status(403).json({ error: "Only victims can access their own consent state" });
      }
      res.json(await readOwn(req.user!.id));
    } catch (err) {
      next(err);
    }
  });

  async function updateScope(req: Request, res: Response) {
    const scope = parseScope(req.params.scope);
    if (!scope) {
      return res.status(400).json({
        error: `Invalid consent scope. Valid scopes: ${CONSENT_SCOPES.join(", ")}`,
      });
    }

    const body = setScopeSchema.parse(req.body);
    const record = await setConsent(req.user!.id, scope, body.granted);

    if (!record) {
      return res
        .status(503)
        .json({ error: "Consent register is not available on this database yet" });
    }

    await recordAudit({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: body.granted ? "consent_granted" : "consent_revoked",
      resourceType: "consent_record",
      resourceId: record.id,
      caseId: null,
      purpose: "data subject exercising consent",
      ip: req.ip,
      metadata: { scope, policy_version: CONSENT_POLICY_VERSION },
    });

    return res.json({
      consent_record: record,
      consent_state: await getConsentState(req.user!.id),
      honesty: "Consent is append-only. This row is now the authoritative decision for this scope.",
    });
  }

  router.patch("/:scope", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      await updateScope(req, res);
    } catch (err) {
      next(err);
    }
  });

  router.put("/:scope", requireAuth, requireRole("victim"), async (req, res, next) => {
    try {
      await updateScope(req, res);
    } catch (err) {
      next(err);
    }
  });

  /** Read-only view for the care team: which scopes are granted, never the content. */
  router.get(
    "/case/:caseId",
    requireAuth,
    requireRole("counsellor", "official", "admin"),
    async (req, res, next) => {
      try {
        const caseRow = await fetchCaseForAccess(req.params.caseId);
        if (!caseRow) return res.status(404).json({ error: "Case not found" });
        if (!canAccessCase(req.user!.role, req.user!.id, caseRow)) {
          return res.status(403).json({ error: "Access denied" });
        }

        const state = await getConsentState(caseRow.victim_id);

        await recordAudit({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "consent_state_viewed",
          resourceType: "consent_record",
          resourceId: caseRow.victim_id,
          caseId: caseRow.id,
          purpose: "care team checking permitted processing",
          ip: req.ip,
          metadata: null,
        });

        res.json({
          case_id: caseRow.id,
          case_number: caseRow.case_number,
          policy_version: CONSENT_POLICY_VERSION,
          consent_state: state.map(({ scope, label, granted, explicit, revoked_at }) => ({
            scope,
            label,
            granted,
            explicit,
            revoked_at,
          })),
          read_only: true,
          honesty: DEFAULT_NOTE,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /** Staff view keyed by victim rather than by case. */
  router.get("/victim/:victimId", requireAuth, async (req, res, next) => {
    try {
      const role = req.user!.role;
      if (role === "victim") {
        return res.status(403).json({ error: "Victims can only read their own consent state" });
      }

      const victimId = String(req.params.victimId);

      const { data: cases } = await supabaseAdmin
        .from("cases")
        .select("id, victim_id, assigned_counsellor_id, assigned_official_id")
        .eq("victim_id", victimId)
        .limit(1);

      if (!cases?.length) {
        return res.status(404).json({ error: "No cases found for this victim" });
      }

      if (!canAccessCase(role, req.user!.id, cases[0])) {
        return res.status(403).json({ error: "Access denied — victim is not assigned to you" });
      }

      res.json({
        victim_id: victimId,
        policy_version: CONSENT_POLICY_VERSION,
        consent_state: await getConsentState(victimId),
        honesty: `Staff view of victim consent state. ${DEFAULT_NOTE}`,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
