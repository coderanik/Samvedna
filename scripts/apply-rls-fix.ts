#!/usr/bin/env tsx
/**
 * Apply critical SQL (RLS recursion fix + victim dashboard tables) via Supabase
 * Management API when SUPABASE_ACCESS_TOKEN is set, otherwise print instructions.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... pnpm exec tsx scripts/apply-rls-fix.ts
 *
 * Or paste the migration file into Supabase → SQL Editor → Run.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: resolve(__dirname, "../.env") });

const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF ??
  (process.env.SUPABASE_URL ?? "").match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_PAT;
const sqlPath = resolve(
  __dirname,
  "../supabase/migrations/20260905000004_rls_fix_and_victim_dashboard.sql"
);

async function main() {
  if (!existsSync(sqlPath)) {
    console.error("Migration file missing:", sqlPath);
    process.exit(1);
  }
  const sql = readFileSync(sqlPath, "utf8");

  if (!TOKEN || !PROJECT_REF) {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  Apply this SQL in Supabase → SQL Editor (required)             ║
╚══════════════════════════════════════════════════════════════════╝

File:
  ${sqlPath}

Project: ${PROJECT_REF ?? "(unknown)"}

This fixes:
  1. profiles 500 — infinite recursion in RLS (profiles ↔ cases)
  2. Victim dashboard tables (instant_calls, consultants, …)

Then re-test:
  pnpm migrate:check
`);
    process.exit(0);
  }

  console.log(`Applying migration to project ${PROJECT_REF} via Management API…`);
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    console.error("Failed:", res.status, text.slice(0, 800));
    process.exit(1);
  }
  console.log("✓ Applied successfully.");
  console.log(text.slice(0, 400));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
