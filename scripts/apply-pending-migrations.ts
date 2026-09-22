#!/usr/bin/env tsx
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: resolve(__dirname, "../.env") });

  FILES = [
  "supabase/migrations/20260905000003_victim_dashboard.sql",
  "supabase/migrations/20260905000004_rls_fix_and_victim_dashboard.sql",
  "supabase/migrations/20260905000004a_rls_recursion_hotfix.sql",
  "supabase/migrations/20260905000005_chat_handoff.sql",
  "supabase/migrations/20260905000006_victim_onboarding.sql",
  "supabase/migrations/20260905000007_sprint1_judiciary_alerts_counselling.sql",
];

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!;
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_PAT;
  const dbUrl =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL ??
    process.env.DIRECT_URL;
  const ref =
    process.env.SUPABASE_PROJECT_REF ??
    (url ?? "").match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];

  console.log({
    ref,
    hasToken: Boolean(token),
    hasDbUrl: Boolean(dbUrl),
    hasServiceKey: Boolean(key),
  });

  const sb = createClient(url, key);
  const before = await sb.from("consultants").select("id").limit(1);
  console.log("consultants before:", before.error?.message ?? "exists");

  if (dbUrl) {
    const pg = await import("pg").catch(() => null);
    if (!pg) {
      console.error("pg package not installed — cannot use DATABASE_URL");
    } else {
      const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await client.connect();
      for (const f of FILES) {
        const path = resolve(__dirname, "..", f);
        if (!existsSync(path)) {
          console.log("skip missing", f);
          continue;
        }
        console.log("Applying", f);
        try {
          await client.query(readFileSync(path, "utf8"));
          console.log("  ✓", f);
        } catch (err) {
          console.error("  ✗", f, err instanceof Error ? err.message : err);
        }
      }
      await client.end();
    }
  } else if (token && ref) {
    for (const f of FILES) {
      const path = resolve(__dirname, "..", f);
      if (!existsSync(path)) continue;
      console.log("Applying via Management API", f);
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${ref}/database/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: readFileSync(path, "utf8") }),
        }
      );
      const text = await res.text();
      console.log(" ", res.status, text.slice(0, 180));
    }
  } else {
    console.log(`
Cannot auto-apply migrations (no DATABASE_URL / SUPABASE_ACCESS_TOKEN).

Paste these in order in Supabase → SQL Editor:
${FILES.map((f) => `  - ${f}`).join("\n")}
`);
    process.exitCode = 2;
    return;
  }

  const after = await sb.from("consultants").select("id").limit(1);
  console.log("consultants after:", after.error?.message ?? "exists");
  const col = await sb.from("profiles").select("onboarding_completed_at").limit(1);
  console.log("onboarding col:", col.error?.message ?? "exists");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
