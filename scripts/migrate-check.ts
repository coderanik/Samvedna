#!/usr/bin/env tsx
/**
 * Verifies DB migrations are applied. Run pending SQL manually in Supabase SQL Editor
 * if call_sessions is missing.
 *
 * Usage: pnpm migrate:check
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env") });

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  const checks: Array<{ table: string; label: string }> = [
    { table: "call_sessions", label: "migration 002 (call_sessions)" },
    { table: "instant_calls", label: "victim dashboard (instant_calls)" },
    { table: "consultants", label: "victim dashboard (consultants)" },
    { table: "exercise_recommendations", label: "victim dashboard (exercises)" },
    { table: "chat_messages", label: "victim dashboard (chat_messages)" },
  ];

  let failed = false;
  for (const c of checks) {
    const { error } = await supabase.from(c.table).select("id").limit(1);
    if (!error) {
      console.log(`✓ ${c.table} — ${c.label}`);
      continue;
    }
    failed = true;
    console.error(`✗ ${c.table} missing (${c.label}): ${error.message}`);
  }

  if (failed) {
    console.error(
      "\nApply pending SQL in Supabase → SQL Editor, especially:\n" +
        "  supabase/migrations/20260905000003_victim_dashboard.sql\n"
    );
    process.exit(1);
  }
}

main();
