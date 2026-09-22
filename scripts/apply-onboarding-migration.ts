#!/usr/bin/env tsx
/**
 * Apply victim onboarding migration via Supabase Management API when
 * SUPABASE_ACCESS_TOKEN is set; otherwise verify + print SQL Editor path.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: resolve(__dirname, "../.env") });

const sqlPath = resolve(
  __dirname,
  "../supabase/migrations/20260905000006_victim_onboarding.sql"
);

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_PAT;
  const ref =
    process.env.SUPABASE_PROJECT_REF ??
    (url ?? "").match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];

  if (!existsSync(sqlPath)) {
    console.error("Missing", sqlPath);
    process.exit(1);
  }

  if (url && key) {
    const sb = createClient(url, key);
    const { error } = await sb
      .from("profiles")
      .select("onboarding_completed_at")
      .limit(1);
    if (!error) {
      console.log("✓ onboarding migration already applied");
      return;
    }
    console.log("Column missing:", error.message);
  }

  const sql = readFileSync(sqlPath, "utf8");
  if (token && ref) {
    console.log(`Applying via Management API to ${ref}…`);
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      }
    );
    const text = await res.text();
    if (!res.ok) {
      console.error("Apply failed", res.status, text);
      process.exit(1);
    }
    console.log("✓ Applied onboarding migration");
    return;
  }

  console.log(`
Apply this SQL in Supabase → SQL Editor:

  ${sqlPath}

Project: ${ref ?? "(unknown)"}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
