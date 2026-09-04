#!/usr/bin/env tsx
/**
 * Ensures the fixed Samvedna admin account exists (create or reset password/role).
 *
 *   pnpm ensure-admin
 *
 * Credentials (fixed):
 *   Email:    admin@samvedna.demo
 *   Password: SamvednaAdmin@2024
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

export const FIXED_ADMIN_EMAIL = "admin@samvedna.demo";
export const FIXED_ADMIN_PASSWORD = "SamvednaAdmin@2024";
export const FIXED_ADMIN_NAME = "System Admin";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email: string) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const found = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  console.log("\n🔐 Ensuring fixed admin account…\n");

  const existing = await findUserByEmail(FIXED_ADMIN_EMAIL);

  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: FIXED_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: "admin",
        full_name: FIXED_ADMIN_NAME,
        preferred_language: "en",
      },
    });
    if (error) throw error;

    await supabase.from("profiles").upsert({
      id: existing.id,
      role: "admin",
      full_name: FIXED_ADMIN_NAME,
      preferred_language: "en",
      phone_number: null,
    });

    console.log(`  ✓ Reset existing admin: ${FIXED_ADMIN_EMAIL}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: FIXED_ADMIN_EMAIL,
      password: FIXED_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: "admin",
        full_name: FIXED_ADMIN_NAME,
        preferred_language: "en",
      },
    });
    if (error) throw error;

    await supabase.from("profiles").upsert({
      id: data.user!.id,
      role: "admin",
      full_name: FIXED_ADMIN_NAME,
      preferred_language: "en",
      phone_number: null,
    });

    console.log(`  + Created admin: ${FIXED_ADMIN_EMAIL}`);
  }

  console.log(`
┌─────────────────────────────────────────┐
│  Fixed admin credentials                │
│  Email:    ${FIXED_ADMIN_EMAIL.padEnd(28)}│
│  Password: ${FIXED_ADMIN_PASSWORD.padEnd(28)}│
│  Portal:   http://localhost:3002/login  │
└─────────────────────────────────────────┘
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
