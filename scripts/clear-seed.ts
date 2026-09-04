#!/usr/bin/env tsx
/**
 * Removes all demo seed data created by `pnpm seed`.
 *
 * Usage:
 *   pnpm clear-seed
 *
 * Deletes: alerts, scores, check-ins, call sessions, cases, recommendations,
 * notes, timeline events, onboarding tokens, and demo auth users (@samvedna.demo).
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env") });
dotenv.config({ path: resolve(__dirname, "../apps/api/.env") });

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing Supabase credentials. Set in .env:\n" +
      "  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)\n" +
      "  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_EMAILS = [
  "admin@samvedna.demo",
  "official@samvedna.demo",
  "counsellor1@samvedna.demo",
  "counsellor2@samvedna.demo",
  "victim1@samvedna.demo",
  "victim2@samvedna.demo",
  "victim3@samvedna.demo",
  "victim4@samvedna.demo",
];

const DEMO_CASE_NUMBERS = [
  "SAM-2024-001",
  "SAM-2024-002",
  "SAM-2024-003",
  "SAM-2024-004",
];

async function deleteWhere(table: string, column: string, ids: string[]) {
  if (ids.length === 0) return 0;
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .in(column, ids);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  console.log("\n🧹 Clearing Samvedna seed data\n");

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw new Error(`listUsers: ${listError.message}`);

  const demoUsers = (listed.users ?? []).filter((u) =>
    DEMO_EMAILS.includes(u.email ?? "")
  );
  const userIds = demoUsers.map((u) => u.id);

  console.log(`Found ${demoUsers.length} demo auth users`);

  const { data: cases } = await supabase
    .from("cases")
    .select("id, case_number")
    .in("case_number", DEMO_CASE_NUMBERS);

  const caseIds = (cases ?? []).map((c) => c.id);
  console.log(`Found ${caseIds.length} demo cases`);

  // Clear FK RESTRICT rows before deleting cases / users
  const steps: Array<[string, number]> = [];

  steps.push(["alerts", await deleteWhere("alerts", "case_id", caseIds)]);
  steps.push([
    "support_recommendations",
    await deleteWhere("support_recommendations", "case_id", caseIds),
  ]);
  steps.push([
    "intervention_notes",
    await deleteWhere("intervention_notes", "case_id", caseIds),
  ]);
  steps.push([
    "case_timeline_events",
    await deleteWhere("case_timeline_events", "case_id", caseIds),
  ]);
  steps.push([
    "onboarding_tokens",
    await deleteWhere("onboarding_tokens", "case_id", caseIds),
  ]);
  steps.push([
    "distress_scores",
    await deleteWhere("distress_scores", "case_id", caseIds),
  ]);
  steps.push(["checkins", await deleteWhere("checkins", "case_id", caseIds)]);
  steps.push([
    "call_sessions",
    await deleteWhere("call_sessions", "case_id", caseIds),
  ]);

  // Also remove any leftover call sessions / checkins for demo users
  if (userIds.length) {
    steps.push([
      "call_sessions (by victim)",
      await deleteWhere("call_sessions", "victim_id", userIds),
    ]);
    steps.push([
      "checkins (by victim)",
      await deleteWhere("checkins", "victim_id", userIds),
    ]);
  }

  steps.push(["cases", await deleteWhere("cases", "id", caseIds)]);

  for (const [label, n] of steps) {
    if (n > 0) console.log(`  − ${label}: ${n}`);
  }

  let deletedUsers = 0;
  for (const user of demoUsers) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      console.warn(`  ! Failed to delete ${user.email}: ${error.message}`);
      continue;
    }
    console.log(`  − auth user: ${user.email}`);
    deletedUsers += 1;
  }

  // Profiles cascade from auth.users; clean any orphaned demo profiles just in case
  if (userIds.length) {
    await supabase.from("profiles").delete().in("id", userIds);
  }

  console.log(`\n✓ Cleared seed data (${deletedUsers} users removed)\n`);
}

main().catch((err) => {
  console.error("\nFailed to clear seed data:", err instanceof Error ? err.message : err);
  process.exit(1);
});
