import { supabaseAdmin } from "./supabase";
import { scoreCheckin } from "./ml-client";
import type { Server as SocketServer } from "socket.io";
import type { CheckinChannel, NewAlertEvent, RiskLevel } from "@samvedna/shared-types";

export async function runScoringPipeline(opts: {
  caseId: string;
  victimId: string;
  checkinId: string;
  transcript: string;
  io?: SocketServer;
}) {
  const { data: caseRow } = await supabaseAdmin
    .from("cases")
    .select("*, profiles!cases_victim_id_fkey(preferred_language, full_name)")
    .eq("id", opts.caseId)
    .single();

  if (!caseRow) throw new Error("Case not found");

  const { data: recentCheckins } = await supabaseAdmin
    .from("checkins")
    .select("raw_transcript, created_at, distress_scores(score, risk_level)")
    .eq("case_id", opts.caseId)
    .order("created_at", { ascending: false })
    .limit(6);

  const recent_history = (recentCheckins ?? [])
    .filter((c) => c.raw_transcript !== opts.transcript)
    .slice(0, 5)
    .map((c) => {
      const scores = c.distress_scores as unknown as Array<{ score: number; risk_level: string }>;
      return {
        transcript: c.raw_transcript,
        score: scores?.[0]?.score ?? 0,
        risk_level: (scores?.[0]?.risk_level ?? "low") as RiskLevel,
        created_at: c.created_at,
      };
    });

  const profileRaw = caseRow.profiles;
  const victimProfile = (Array.isArray(profileRaw) ? profileRaw[0] : profileRaw) as {
    preferred_language: string;
    full_name: string;
  } | null;

  const daysSinceOpened = Math.floor(
    (Date.now() - new Date(caseRow.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const scoreResult = await scoreCheckin({
    transcript: opts.transcript,
    recent_history,
    case_metadata: {
      case_type: caseRow.case_type,
      days_since_opened: daysSinceOpened,
      preferred_language: victimProfile?.preferred_language ?? "en",
    },
  });

  const { data: distressScore, error: scoreError } = await supabaseAdmin
    .from("distress_scores")
    .insert({
      checkin_id: opts.checkinId,
      case_id: opts.caseId,
      score: scoreResult.score,
      risk_level: scoreResult.risk_level,
      reasoning: scoreResult.reasoning,
      signals_detected: scoreResult.signals_detected,
    })
    .select()
    .single();

  if (scoreError || !distressScore) throw new Error("Failed to save distress score");

  let alert = null;
  if (scoreResult.risk_level === "high" || scoreResult.risk_level === "critical") {
    const assignee = caseRow.assigned_counsellor_id ?? caseRow.assigned_official_id;
    if (assignee) {
      const { data: alertRow } = await supabaseAdmin
        .from("alerts")
        .insert({
          case_id: opts.caseId,
          distress_score_id: distressScore.id,
          severity: scoreResult.risk_level,
          status: "open",
          assigned_to: assignee,
        })
        .select()
        .single();

      alert = alertRow;

      if (opts.io && alertRow) {
        const event: NewAlertEvent = {
          alert: alertRow,
          case_id: opts.caseId,
          case_number: caseRow.case_number,
          victim_name: victimProfile?.full_name ?? "Unknown",
          severity: scoreResult.risk_level,
          reasoning: scoreResult.reasoning,
        };
        opts.io.to(`case:${opts.caseId}`).emit("new_alert", event);
        opts.io.to(`user:${assignee}`).emit("new_alert", event);
      }
    }
  }

  await supabaseAdmin.from("case_timeline_events").insert({
    case_id: opts.caseId,
    event_type: "checkin_completed",
    description: `Check-in scored. Distress: ${scoreResult.score} (${scoreResult.risk_level})`,
    created_by: opts.victimId,
  });

  return { distressScore, alert, scoreResult };
}

export async function createCheckinAndScore(opts: {
  caseId: string;
  victimId: string;
  transcript: string;
  channel: CheckinChannel;
  io?: SocketServer;
}) {
  const { data: checkin, error } = await supabaseAdmin
    .from("checkins")
    .insert({
      case_id: opts.caseId,
      victim_id: opts.victimId,
      channel: opts.channel,
      raw_transcript: opts.transcript,
    })
    .select()
    .single();

  if (error || !checkin) throw new Error("Failed to save check-in");

  const result = await runScoringPipeline({
    caseId: opts.caseId,
    victimId: opts.victimId,
    checkinId: checkin.id,
    transcript: opts.transcript,
    io: opts.io,
  });

  return { checkin, ...result };
}
