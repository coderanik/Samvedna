/**
 * Hash-chained audit ledger for victim-data access.
 *
 * Each entry commits to its predecessor: entry_hash = sha256(prev_hash + canonical_json(entry)).
 * That only holds if entries are appended one at a time — two concurrent writers
 * would both read the same tail and produce two rows claiming the same parent.
 * The in-process mutex below serialises append(); with a single API process that
 * is sufficient, and `verifyAuditChain` will surface any break if it isn't.
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "./supabase";
import { safeQuery } from "./db-safe";
import type { UserRole } from "@samvedna/shared-types";

export const GENESIS_HASH = "0".repeat(64);

const IP_HASH_SALT = process.env.AUDIT_IP_SALT ?? "samvedna-audit-v1";

export interface AuditEntryInput {
  actorId: string | null;
  actorRole: UserRole | string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  caseId?: string | null;
  purpose?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  case_id: string | null;
  purpose: string | null;
  ip_hash: string | null;
  metadata: Record<string, unknown> | null;
  prev_hash: string | null;
  entry_hash: string | null;
  created_at: string;
}

export interface AuditChainVerification {
  valid: boolean;
  entries_checked: number;
  first_broken_id: number | null;
  reason: string | null;
}

/** Deterministic JSON: keys sorted, undefined dropped, no incidental whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** The exact fields, in the exact shape, that the hash commits to. */
export function auditPayload(row: {
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  case_id: string | null;
  purpose: string | null;
  ip_hash: string | null;
  metadata: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    action: row.action,
    actor_id: row.actor_id ?? null,
    actor_role: row.actor_role ?? null,
    case_id: row.case_id ?? null,
    ip_hash: row.ip_hash ?? null,
    metadata: row.metadata ?? null,
    purpose: row.purpose ?? null,
    resource_id: row.resource_id ?? null,
    resource_type: row.resource_type,
  };
}

export function hashEntry(prevHash: string, payload: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(prevHash + canonicalJson(payload))
    .digest("hex");
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(IP_HASH_SALT + ip).digest("hex").slice(0, 32);
}

/** Serialises appends so prev_hash reads and writes cannot interleave. */
let chainLock: Promise<unknown> = Promise.resolve();

function withChainLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chainLock.then(fn, fn);
  // Keep the lock chain alive even if this append rejects.
  chainLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Append an audit entry. Never throws: an unrecordable access must not become
 * a denied access, and the caller is usually mid-response.
 */
export async function recordAudit(input: AuditEntryInput): Promise<AuditRow | null> {
  try {
    return await withChainLock(async () => {
      const { data: tail } = await safeQuery<{ entry_hash: string | null }[]>(
        "audit_log:tail",
        () =>
          supabaseAdmin
            .from("audit_log")
            .select("entry_hash")
            .order("id", { ascending: false })
            .limit(1)
      );

      const prevHash = tail?.[0]?.entry_hash ?? GENESIS_HASH;

      const base = {
        actor_id: input.actorId ?? null,
        actor_role: input.actorRole != null ? String(input.actorRole) : null,
        action: input.action,
        resource_type: input.resourceType,
        resource_id: input.resourceId ?? null,
        case_id: input.caseId ?? null,
        purpose: input.purpose ?? null,
        ip_hash: hashIp(input.ip),
        metadata: input.metadata ?? null,
      };

      const entryHash = hashEntry(prevHash, auditPayload(base));

      const { data } = await safeQuery<AuditRow>("audit_log:insert", () =>
        supabaseAdmin
          .from("audit_log")
          .insert({ ...base, prev_hash: prevHash, entry_hash: entryHash })
          .select()
          .single()
      );

      return data;
    });
  } catch (err) {
    console.warn("[audit] record failed (non-blocking)", err instanceof Error ? err.message : err);
    return null;
  }
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

/**
 * Records the access after the response is on its way, so audit latency and
 * audit failures are both invisible to the caller.
 */
export function auditMiddleware(action: string, resourceType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const caseId =
      (req.params?.caseId as string | undefined) ??
      (req.params?.id as string | undefined) ??
      (typeof req.body?.case_id === "string" ? req.body.case_id : undefined) ??
      null;

    res.on("finish", () => {
      // Only log accesses that actually returned data.
      if (res.statusCode >= 400) return;
      void recordAudit({
        actorId: req.user?.id ?? null,
        actorRole: req.user?.role ?? null,
        action,
        resourceType,
        resourceId: (req.params?.id as string | undefined) ?? caseId,
        caseId,
        purpose: (req.header("x-access-purpose") || req.query?.purpose) as string | null,
        ip: clientIp(req),
        metadata: { method: req.method, path: req.originalUrl, status: res.statusCode },
      });
    });

    next();
  };
}

const VERIFY_PAGE = 500;

/** Walk the whole chain in id order and report the first link that fails. */
export async function verifyAuditChain(): Promise<AuditChainVerification> {
  let prevHash = GENESIS_HASH;
  let checked = 0;
  let from = 0;

  for (;;) {
    const { data, degraded } = await safeQuery<AuditRow[]>("audit_log:verify", () =>
      supabaseAdmin
        .from("audit_log")
        .select("*")
        .gt("id", from)
        .order("id", { ascending: true })
        .limit(VERIFY_PAGE)
    );

    if (degraded) {
      return {
        valid: false,
        entries_checked: 0,
        first_broken_id: null,
        reason: "audit_log table is not available (migration not applied)",
      };
    }

    const rows = data ?? [];
    if (!rows.length) break;

    for (const row of rows) {
      if ((row.prev_hash ?? GENESIS_HASH) !== prevHash) {
        return {
          valid: false,
          entries_checked: checked,
          first_broken_id: row.id,
          reason: `prev_hash mismatch at id ${row.id} — an entry was deleted or reordered`,
        };
      }

      const expected = hashEntry(prevHash, auditPayload(row));
      if (row.entry_hash !== expected) {
        return {
          valid: false,
          entries_checked: checked,
          first_broken_id: row.id,
          reason: `entry_hash mismatch at id ${row.id} — the row content was altered after write`,
        };
      }

      prevHash = row.entry_hash;
      checked += 1;
      from = row.id;
    }

    if (rows.length < VERIFY_PAGE) break;
  }

  return { valid: true, entries_checked: checked, first_broken_id: null, reason: null };
}
