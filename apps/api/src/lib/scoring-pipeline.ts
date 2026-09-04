import { supabaseAdmin } from "./supabase";
import { scoreCheckin } from "./ml-client";
import {
  computeDistressIntelligence,
} from "./distress-intelligence";
import { composeDistressScore } from "./composite-score";
import { detectCrisis } from "./crisis-detect";
import { upsertCadenceAfterScore } from "./cadence-engine";
import { recommendPoaInterventions } from "./intervention-engine";
import type { Server as SocketServer } from "socket.io";
import type {
  CheckinChannel,
  NewAlertEvent,
  RiskLevel,
  SupportType,
} from "@samvedna/shared-types";

const SUPPORT_TYPES = new Set([
  "counselling",
  "medical",
  "legal",
  "financial",
  "protection",
  "rehabilitation",
  "relocation",
  "witness_protection",
  "follow_up",
]);

async function emitAlert(
  io: SocketServer | undefined,
  assignee: string,
  event: NewAlertEvent,
  caseId: string
) {
  if (!io) return;
  io.to(`case:${caseId}`).emit("new_alert", event);
  io.to(`user:${assignee}`).emit("new_alert", event);
}

export async function runScoringPipeline(opts: {
  caseId: string;
  victimId: string;
  checkinId: string;
  transcript: string;
  channel?: CheckinChannel;
  io?: SocketServer;
}) {
  const { data: caseRow } = await supabaseAdmin
    .from("cases")
    .select("*, profiles!cases_victim_id_fkey(preferred_language, full_name)")
    .eq("id", opts.caseId)
    .single();

  if (!caseRow) throw new Error("Case not found");

  const crisis = detectCrisis(opts.transcript);

  const { data: recentCheckins } = await supabaseAdmin
    .from("checkins")
    .select("id, raw_transcript, created_at, distress_scores(score, risk_level, created_at)")
    .eq("case_id", opts.caseId)
    .order("created_at", { ascending: false })
    .limit(8);

  const recent_history = (recentCheckins ?? [])
    .filter((c) => c.id !== opts.checkinId)
    .slice(0, 5)
    .map((c) => {
      const scores = c.distress_scores as unknown as Array<{
        score: number;
        risk_level: string;
        created_at: string;
      }>;
      return {
        transcript: c.raw_transcript,
        score: scores?.[0]?.score ?? 0,
        risk_level: (scores?.[0]?.risk_level ?? "low") as RiskLevel,
        created_at: scores?.[0]?.created_at ?? c.created_at,
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

  const lastCheckinAt = recent_history[0]?.created_at;
  const daysSinceLast = lastCheckinAt
    ? (Date.now() - new Date(lastCheckinAt).getTime()) / 86400000
    : null;

  const { count: missedCount } = await supabaseAdmin
    .from("outreach_schedule")
    .select("*", { count: "exact", head: true })
    .eq("case_id", opts.caseId)
    .eq("status", "missed");

  const scoreResult = await scoreCheckin({
    transcript: opts.transcript,
    recent_history,
    case_metadata: {
      case_type: caseRow.case_type,
      days_since_opened: daysSinceOpened,
      preferred_language: victimProfile?.preferred_language ?? "en",
      case_status: caseRow.status,
      channel: opts.channel,
    },
  });

  const composite = composeDistressScore({
    textScore: scoreResult.score,
    textSignals: scoreResult.signals_detected ?? [],
    textReasoning: scoreResult.reasoning,
    caseType: caseRow.case_type,
    caseStatus: caseRow.status,
    daysSinceOpened,
    nextHearingDate: caseRow.next_hearing_date ?? null,
    missedOutreach30d: missedCount ?? 0,
    daysSinceLastCheckin: daysSinceLast,
    crisisOverride: crisis.override,
    crisisReason: crisis.reason,
  });

  const finalScore = composite.score;
  const finalRisk = composite.risk_level;

  const intel = computeDistressIntelligence(
    { score: finalScore, risk_level: finalRisk },
    recent_history,
    scoreResult.signals_detected ?? []
  );

  const trend_direction = scoreResult.trend_direction ?? intel.trend_direction;
  const escalation_risk_7d = crisis.override
    ? 95
    : Math.max(scoreResult.escalation_risk_7d ?? 0, intel.escalation_risk_7d);
  const contributing_factors = [
    ...new Set([
      ...(scoreResult.contributing_factors ?? []),
      ...intel.contributing_factors,
      ...composite.contributions.map((c) => c.feature),
    ]),
  ];

  const poa = await recommendPoaInterventions({
    caseType: caseRow.case_type,
    risk: finalRisk,
    escalation: escalation_risk_7d,
    signals: scoreResult.signals_detected ?? [],
  });

  const interventions = poa.map((p) => ({
    type: p.support_type,
    description: `${p.title} — ${p.statutory_basis} (${p.responsible_authority}, SLA ${p.sla_hours}h). ${p.match_rationale}`,
  }));

  const insertPayload: Record<string, unknown> = {
    checkin_id: opts.checkinId,
    case_id: opts.caseId,
    score: finalScore,
    risk_level: finalRisk,
    reasoning: crisis.override
      ? `CRISIS OVERRIDE: ${crisis.reason}`
      : `${scoreResult.reasoning} | Composite ${composite.composite_version}`,
    signals_detected: scoreResult.signals_detected,
    trend_direction,
    escalation_risk_7d,
    escalation_reasoning:
      scoreResult.escalation_reasoning ??
      `MVP predictive-risk ${escalation_risk_7d}/100 from composite + trend.`,
    recommended_interventions: interventions,
    sentiment: scoreResult.sentiment ?? null,
    emotion_indicators: scoreResult.emotion_indicators ?? [],
    contributing_factors,
    model_confidence: crisis.override ? "high" : scoreResult.model_confidence ?? "medium",
    prediction_method: scoreResult.prediction_method ?? intel.prediction_method,
    component_clinical: composite.components.clinical,
    component_text: composite.components.text,
    component_voice: composite.components.voice,
    component_behavioural: composite.components.behavioural,
    component_context: composite.components.context,
    composite_version: composite.composite_version,
    crisis_override: composite.crisis_override,
    crisis_override_reason: composite.crisis_override_reason,
  };

  let { data: saved, error: scoreError } = await supabaseAdmin
    .from("distress_scores")
    .insert(insertPayload)
    .select()
    .single();

  if (scoreError || !saved) {
    console.warn("[scoring] rich insert failed, retrying minimal", scoreError?.message);
    const retry = await supabaseAdmin
      .from("distress_scores")
      .insert({
        checkin_id: opts.checkinId,
        case_id: opts.caseId,
        score: finalScore,
        risk_level: finalRisk,
        reasoning: insertPayload.reasoning,
        signals_detected: scoreResult.signals_detected,
      })
      .select()
      .single();
    if (retry.error || !retry.data) throw new Error("Failed to save distress score");
    saved = retry.data;
  }

  // Persist XAI contributions (ignore if table missing)
  if (saved?.id) {
    for (const c of composite.contributions) {
      await supabaseAdmin.from("score_contributions").insert({
        distress_score_id: saved.id,
        channel: c.channel,
        feature: c.feature,
        feature_label: c.feature_label,
        raw_value: c.raw_value,
        weight: c.weight,
        contribution: c.contribution,
        direction: c.direction,
        evidence: c.evidence,
      });
    }
  }

  // Dedup support suggestions by type for this case (suggested only)
  for (const rec of interventions.slice(0, 4)) {
    const type = SUPPORT_TYPES.has(rec.type) ? (rec.type as SupportType) : "counselling";
    const { data: existing } = await supabaseAdmin
      .from("support_recommendations")
      .select("id")
      .eq("case_id", opts.caseId)
      .eq("type", type)
      .eq("status", "suggested")
      .limit(1);
    if (existing?.length) continue;
    await supabaseAdmin.from("support_recommendations").insert({
      case_id: opts.caseId,
      alert_id: null,
      type,
      description: rec.description,
      status: "suggested",
    });
  }

  try {
    await upsertCadenceAfterScore({
      caseId: opts.caseId,
      risk: finalRisk,
      escalation: escalation_risk_7d,
      nextHearingDate: caseRow.next_hearing_date ?? null,
    });
  } catch (e) {
    console.warn("[cadence] skipped", e);
  }

  const shouldAlert =
    crisis.override ||
    finalRisk === "high" ||
    finalRisk === "critical" ||
    escalation_risk_7d >= 70;

  const recommended_action = crisis.override
    ? "CRISIS — contact KIRAN / Tele-MANAS / 112 immediately; notify counsellor now."
    : finalRisk === "critical" || escalation_risk_7d >= 75
      ? "Immediate counsellor intervention recommended."
      : "Priority counselling and follow-up recommended.";

  const recipients = [
    ...new Set(
      [caseRow.assigned_counsellor_id, caseRow.assigned_official_id].filter(Boolean) as string[]
    ),
  ];

  const alerts = [];
  if (shouldAlert && recipients.length) {
    for (const assignee of recipients) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabaseAdmin
        .from("alerts")
        .select("id")
        .eq("case_id", opts.caseId)
        .eq("assigned_to", assignee)
        .in("status", ["open", "acknowledged"])
        .gte("created_at", since)
        .limit(1);
      if (existing?.length && !crisis.override) continue;

      const severity: RiskLevel =
        crisis.override || finalRisk === "critical" ? "critical" : finalRisk === "high" ? "high" : "high";

      const { data: alertRow } = await supabaseAdmin
        .from("alerts")
        .insert({
          case_id: opts.caseId,
          distress_score_id: saved!.id,
          severity,
          status: "open",
          assigned_to: assignee,
        })
        .select()
        .single();

      if (alertRow) {
        alerts.push(alertRow);
        await emitAlert(
          opts.io,
          assignee,
          {
            alert: alertRow,
            case_id: opts.caseId,
            case_number: caseRow.case_number,
            victim_name: victimProfile?.full_name ?? "Confidential",
            severity,
            reasoning: String(insertPayload.reasoning),
            escalation_risk_7d,
            trend_direction,
            recommended_action,
          },
          opts.caseId
        );
      }
    }
  }

  await supabaseAdmin.from("case_timeline_events").insert({
    case_id: opts.caseId,
    event_type: crisis.override ? "crisis_override" : "checkin_completed",
    description: `Score ${finalScore} (${finalRisk}); trend ${trend_direction}; esc ${escalation_risk_7d}`,
    created_by: opts.victimId,
  });

  return {
    distressScore: {
      ...saved!,
      score: finalScore,
      risk_level: finalRisk,
      trend_direction,
      escalation_risk_7d,
      recommended_interventions: interventions,
      contributing_factors,
      crisis_override: composite.crisis_override,
    },
    alert: alerts[0] ?? null,
    alerts,
    scoreResult,
    composite,
    poa,
    intelligence: {
      trend_direction,
      escalation_risk_7d,
      contributing_factors,
      priority_hint: recommended_action,
    },
  };
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
    channel: opts.channel,
    io: opts.io,
  });

  return { checkin, ...result };
}
