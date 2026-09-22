#!/usr/bin/env tsx
/**
 * Smoke-test core API paths with demo victim + counsellor accounts.
 * Does not mutate production data beyond a soft onboarding status read.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: resolve(__dirname, "../.env") });

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY!;
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!;

async function signIn(email: string, password: string) {
  const sb = createClient(URL, ANON);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`${email}: ${error?.message}`);
  return data.session.access_token;
}

async function hit(
  path: string,
  token: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown; ok: boolean }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body, ok: res.ok };
}

async function tableOk(name: string) {
  const sb = createClient(URL, SERVICE);
  const { error } = await sb.from(name).select("id").limit(1);
  return !error;
}

async function main() {
  console.log("=== Schema ===");
  for (const t of [
    "cases",
    "checkins",
    "distress_scores",
    "alerts",
    "consultants",
    "consultant_assignments",
    "victim_onboarding_responses",
    "support_recommendations",
  ]) {
    console.log(`${(await tableOk(t)) ? "✓" : "✗"} ${t}`);
  }

  const { error: colErr } = await createClient(URL, SERVICE)
    .from("profiles")
    .select("onboarding_completed_at")
    .limit(1);
  console.log(
    `${colErr ? "✗" : "✓"} profiles.onboarding_completed_at${colErr ? ` (${colErr.message})` : ""}`
  );

  console.log("\n=== Health ===");
  console.log("API", await (await fetch(`${API}/health`)).json());

  console.log("\n=== Victim endpoints ===");
  const vToken = await signIn("victim1@samvedna.demo", "Samvedna@2024");
  for (const path of [
    "/victim/dashboard",
    "/victim/consultant",
    "/victim/onboarding/status",
    "/victim/exercises",
    "/victim/profile",
  ]) {
    const r = await hit(path, vToken);
    const err =
      typeof r.body === "object" && r.body && "error" in (r.body as object)
        ? ` err=${(r.body as { error: string }).error}`
        : "";
    console.log(`${r.ok ? "✓" : "✗"} GET ${path} → ${r.status}${err}`);
  }

  console.log("\n=== Counsellor endpoints ===");
  const cToken = await signIn("counsellor1@samvedna.demo", "Samvedna@2024");
  for (const path of ["/dashboard/priority-queue", "/cases", "/alerts", "/outreach/gone-quiet"]) {
    const r = await hit(path, cToken);
    const err =
      typeof r.body === "object" && r.body && "error" in (r.body as object)
        ? ` err=${(r.body as { error: string }).error}`
        : "";
    let extra = "";
    if (r.ok && Array.isArray(r.body)) extra = ` (${r.body.length} rows)`;
    console.log(`${r.ok ? "✓" : "✗"} GET ${path} → ${r.status}${extra}${err}`);
  }

  // Case detail + recommendations if we have a case
  const cases = await hit("/cases", cToken);
  if (cases.ok && Array.isArray(cases.body) && cases.body.length) {
    const first = cases.body[0] as { id: string };
    for (const path of [
      `/cases/${first.id}`,
      `/cases/${first.id}/timeline`,
      `/cases/${first.id}/recommendations`,
    ]) {
      const r = await hit(path, cToken);
      const err =
        typeof r.body === "object" && r.body && "error" in (r.body as object)
          ? ` err=${(r.body as { error: string }).error}`
          : "";
      console.log(`${r.ok ? "✓" : "✗"} GET ${path} → ${r.status}${err}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
