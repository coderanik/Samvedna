import { connectTwoNumbers, getExotelConfig, isExotelConfigured } from "./exotel";
import { supabaseAdmin } from "./supabase";

/** Bridge victim ↔ counsellor via Exotel when both have phone numbers. */
export async function bridgeCounsellorCall(sessionId: string): Promise<{ callSid: string } | null> {
  if (!isExotelConfigured()) return null;

  const { data: session } = await supabaseAdmin
    .from("call_sessions")
    .select(`
      id, victim_id, counsellor_id,
      victim:profiles!call_sessions_victim_id_fkey(phone_number),
      counsellor:profiles!call_sessions_counsellor_id_fkey(phone_number)
    `)
    .eq("id", sessionId)
    .single();

  if (!session?.counsellor_id) return null;

  const victimRaw = session.victim;
  const counsellorRaw = session.counsellor;
  const victimPhone = (Array.isArray(victimRaw) ? victimRaw[0] : victimRaw)?.phone_number;
  const counsellorPhone = (Array.isArray(counsellorRaw) ? counsellorRaw[0] : counsellorRaw)?.phone_number;

  if (!victimPhone || !counsellorPhone) {
    console.warn("[Exotel] Bridge skipped — missing phone on victim or counsellor");
    return null;
  }

  const cfg = getExotelConfig();
  const statusCallback = cfg?.webhookBaseUrl
    ? `${cfg.webhookBaseUrl}/webhooks/exotel/voice/status`
    : undefined;

  const { callSid } = await connectTwoNumbers({
    from: counsellorPhone,
    to: victimPhone,
    customField: `session:${sessionId}`,
    record: true,
    statusCallbackUrl: statusCallback,
  });

  await supabaseAdmin
    .from("call_sessions")
    .update({ exotel_call_sid: callSid, status: "ringing" })
    .eq("id", sessionId);

  return { callSid };
}
