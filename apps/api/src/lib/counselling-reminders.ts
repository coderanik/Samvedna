/**
 * Counselling session reminders via Expo push (+ email fallback handled elsewhere).
 * Called from cadence tick.
 */
import { supabaseAdmin } from "./supabase";
import { sendPushToUser } from "./push";

const REMINDER_WINDOW_MS = 75 * 60_000; // next ~75 minutes

export async function sweepCounsellingReminders(): Promise<number> {
  const now = Date.now();
  const from = new Date(now).toISOString();
  const to = new Date(now + REMINDER_WINDOW_MS).toISOString();

  const { data: sessions, error } = await supabaseAdmin
    .from("counselling_sessions")
    .select("id, victim_id, case_id, scheduled_at, video_room_url, reminder_sent_at, status")
    .eq("status", "scheduled")
    .is("reminder_sent_at", null)
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .limit(50);

  if (error) {
    console.warn("[counselling-reminders]", error.message);
    return 0;
  }
  if (!sessions?.length) return 0;

  let sent = 0;
  for (const s of sessions) {
    const when = new Date(s.scheduled_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const push = await sendPushToUser(s.victim_id, {
      title: "Counselling session soon",
      body: `Your 60-minute care session starts around ${when}. Open Samvedna to Join when ready.`,
      data: {
        kind: "counselling_reminder",
        session_id: s.id,
        case_id: s.case_id,
        video_room_url: s.video_room_url,
      },
    });

    await supabaseAdmin
      .from("counselling_sessions")
      .update({
        reminder_sent_at: new Date().toISOString(),
        status: push.sent > 0 ? "reminded" : "scheduled",
      })
      .eq("id", s.id);

    if (push.sent > 0) sent++;
  }

  return sent;
}
