#!/usr/bin/env tsx
/**
 * Verifies DB migrations are applied. Run pending SQL manually in Supabase SQL Editor
 * if call_sessions is missing.
 *
 * Usage: pnpm migrate:check
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
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
  const { error } = await supabase.from("call_sessions").select("id").limit(1);

  if (!error) {
    console.log("✓ call_sessions table exists — migration 002 is applied.");
    return;
  }

  if (error.code === "42P01" || error.message.includes("call_sessions")) {
    const sqlPath = resolve(__dirname, "../supabase/migrations/20240829000002_call_sessions.sql");
    console.error("✗ call_sessions table missing.");
    console.error("\nApply migration 002 in Supabase → SQL Editor:\n");
    console.error(`  File: ${sqlPath}\n`);
    console.error(readFileSync(sqlPath, "utf8"));
    process.exit(1);
  }

  console.error("Unexpected error checking migrations:", error.message);
  process.exit(1);
}

main();
