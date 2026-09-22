/**
 * Expo Push API helper — victim mobile alerts & counselling reminders.
 */
import { supabaseAdmin } from "./supabase";

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
};

export async function registerPushToken(opts: {
  userId: string;
  token: string;
  platform?: string;
  appVersion?: string;
}) {
  const token = opts.token.trim();
  if (!token || token.length < 20) {
    return { ok: false as const, error: "invalid_token" };
  }

  const { error } = await supabaseAdmin.from("push_tokens").upsert(
    {
      user_id: opts.userId,
      token,
      platform: opts.platform ?? null,
      app_version: opts.appVersion ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id,token" }
  );

  if (error) {
    console.warn("[push_tokens]", error.message);
    return { ok: false as const, error: error.message };
  }
  return { ok: true as const };
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const { data: rows } = await supabaseAdmin
    .from("push_tokens")
    .select("token")
    .eq("user_id", userId);

  const tokens = (rows ?? []).map((r) => r.token).filter(Boolean);
  if (!tokens.length) return { sent: 0, failed: 0 };

  const messages = tokens.map((to) => ({
    to,
    sound: payload.sound ?? "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      console.warn("[expo-push] HTTP", res.status);
      return { sent: 0, failed: tokens.length };
    }
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{ status?: string }>;
    } | null;
    const results = Array.isArray(json?.data) ? json!.data! : [];
    const sent = results.filter((r) => r.status === "ok").length || tokens.length;
    const failed = Math.max(0, tokens.length - sent);
    return { sent, failed };
  } catch (err) {
    console.warn("[expo-push]", err instanceof Error ? err.message : err);
    return { sent: 0, failed: tokens.length };
  }
}

/** Soft victim-facing alert — never includes distress scores. */
export async function pushVictimCareNotice(
  victimId: string,
  opts: { title: string; body: string; data?: Record<string, unknown> }
) {
  return sendPushToUser(victimId, {
    title: opts.title,
    body: opts.body,
    data: { ...opts.data, kind: "care_notice" },
  });
}
