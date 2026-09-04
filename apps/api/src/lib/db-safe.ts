/**
 * Schema-tolerant Supabase helpers.
 *
 * The v2 migration may not be applied when this code runs (demo boxes, fresh
 * clones, judges pulling mid-review). Every read/write against a v2 table or
 * column goes through here so a missing relation degrades the feature instead
 * of failing the check-in that triggered it.
 */

import type { PostgrestError } from "@supabase/supabase-js";

/** Postgres / PostgREST codes for "you asked for something that isn't there". */
const MISSING_SCHEMA_CODES = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "PGRST200", // could not find relationship
  "PGRST202", // could not find function
  "PGRST204", // column not found in schema cache
]);

const MISSING_SCHEMA_PATTERNS = [
  /does not exist/i,
  /could not find the .* column/i,
  /could not find the table/i,
  /schema cache/i,
  /unknown column/i,
];

export function isMissingSchemaError(error: unknown): boolean {
  if (!error) return false;
  const e = error as Partial<PostgrestError> & { message?: string };
  if (e.code && MISSING_SCHEMA_CODES.has(e.code)) return true;
  const text = `${e.message ?? ""} ${e.details ?? ""}`;
  return MISSING_SCHEMA_PATTERNS.some((re) => re.test(text));
}

/** One warning per feature per process — the tick would otherwise spam every 60s. */
const warned = new Set<string>();

export function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[schema] ${message}`);
}

export function resetSchemaWarnings() {
  warned.clear();
}

export interface SafeResult<T> {
  data: T | null;
  /** True when the query failed because the v2 migration is not applied yet. */
  degraded: boolean;
  error: PostgrestError | Error | null;
}

/**
 * Run a Supabase query builder and swallow "missing table/column" failures.
 * `label` is used both for the one-shot log and as the dedup key.
 */
export async function safeQuery<T>(
  label: string,
  run: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>
): Promise<SafeResult<T>> {
  try {
    const { data, error } = await run();
    if (error) {
      if (isMissingSchemaError(error)) {
        warnOnce(label, `${label} unavailable (migration not applied): ${error.message}`);
        return { data: null, degraded: true, error };
      }
      console.warn(`[db] ${label} failed: ${error.message}`);
      return { data: null, degraded: false, error };
    }
    return { data, degraded: false, error: null };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (isMissingSchemaError(error)) {
      warnOnce(label, `${label} unavailable (migration not applied): ${error.message}`);
      return { data: null, degraded: true, error };
    }
    console.warn(`[db] ${label} threw: ${error.message}`);
    return { data: null, degraded: false, error };
  }
}

/**
 * Insert with a narrower retry: if the rich payload names columns the current
 * schema lacks, retry with only `fallbackKeys` before giving up. Mirrors the
 * retry that distress_scores has always used.
 */
export async function safeInsertWithFallback<T>(
  label: string,
  payload: Record<string, unknown>,
  fallbackKeys: string[],
  insert: (row: Record<string, unknown>) => PromiseLike<{ data: T | null; error: PostgrestError | null }>
): Promise<SafeResult<T>> {
  const first = await safeQuery<T>(label, () => insert(payload));
  if (first.data || !first.degraded) return first;

  const minimal: Record<string, unknown> = {};
  for (const key of fallbackKeys) {
    if (key in payload) minimal[key] = payload[key];
  }
  if (!Object.keys(minimal).length) return first;

  warnOnce(`${label}:fallback`, `${label} retrying with minimal columns`);
  return safeQuery<T>(`${label}:minimal`, () => insert(minimal));
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
