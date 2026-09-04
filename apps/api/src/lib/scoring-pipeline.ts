import { supabaseAdmin } from "./supabase";
import { scoreCheckin } from "./ml-client";
import { computeDistressIntelligence } from "./distress-intelligence";
import {
  COMPOSITE_VERSION,
  composeDistressScore,
  detectCrisis,
  type ClinicalAssessmentInput,
  type CompositeResult,
  type CrisisAssessmentInput,
  type VoiceAnalysisInput,
} from "./composite-score";
import { computeEngagement, type EngagementClientMetrics, type EngagementResult } from "./engagement";
import { upsertCadenceAfterScore, markOutreachResponded } from "./cadence-engine";
import {
  persistRecommendations,
  recommendInterventions,
  type InterventionMatch,
} from "./intervention-engine";
import { hasConsent } from "./consent";
import { recordAudit } from "./audit";
import { safeQuery, safeInsertWithFallback } from "./db-safe";
import type { Server as SocketServer } from "socket.io";
import type {
  CheckinChannel,
  NewAlertEvent,
  RiskLevel,
} from "@samvedna/shared-types";

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

/** Names on the case worth redacting before the transcript leaves the process. */
function knownNamesFor(caseRow: Record<string, unknown>, victimName?: string | null): string[] {
  const names: string[] = [];
  if (victimName) names.push(victimName);
  for (const key of ["accused_name", "accused_names", "witness_names", "complainant_name"]) {
    const value = caseRow[key];
    if (typeof value === "string") names.push(value);
    else if (Array.isArray(value)) names.push(...value.filter((v): v is string => typeof v === "string"));
  }
  return names;
}

/** Consecutive most-recent check-ins that scored low — earns the maintenance tier. */
function countStableCheckins(historyNewestFirst: Array<{ risk_level: RiskLevel }>): number {
  let n = 0;
  for (const point of historyNewestFirst) {
    if (point.risk_level === "low") n += 1;
    else break;
  }
  return n;
}

export interface RunScoringPipelineOptions {
  caseId: string;
  victimId: string;
  checkinId: string;
  transcript: string;
  channel?: CheckinChannel;
  io?: SocketServer;
  /** Client-side interaction telemetry for the behavioural channel. */
  engagementMetrics?: EngagementClientMetrics;
  /** Outreach row this check-in is answering, if the client knows it. */
  outreachId?: string | null;
}

export async function runScoringPipeline(opts: RunScoringPipelineOptions) {
  const { data: caseRow } = await supabaseAdmin
    .from("cases")
    .select("*, profiles!cases_victim_id_fkey(preferred_language, full_name)")
    .eq("id", opts.caseId)
    .single();

  if (!caseRow) throw new Error("Case not found");

  const profileRaw = caseRow.profiles;
  const victimProfile = (Array.isArray(profileRaw) ? profileRaw[0] : profileRaw) as {
    preferred_language: string;
    full_name: string;
  } | null;

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

  const daysSinceOpened = Math.floor(
    (Date.now() - new Date(caseRow.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const lastCheckinAt = recent_history[0]?.created_at;
  const daysSinceLast = lastCheckinAt
    ? (Date.now() - new Date(lastCheckinAt).getTime()) / 86400000
    : null;

  // ── 1. consent gate ───────────────────────────────────────────────────────
  // Enforced, not logged: without llm_processing consent no language model is
  // called at all, and the reasoning string says so.
  const llmAllowed = await hasConsent(opts.victimId, "llm_processing");

  // ── 2. redact + score (redaction happens inside the ML client) ─────────────
  const scoreResult = await scoreCheckin(
    {
      transcript: opts.transcript,
      recent_history,
      case_metadata: {
        case_type: caseRow.case_type,
        days_since_opened: daysSinceOpened,
        preferred_language: victimProfile?.preferred_language ?? "en",
        case_status: caseRow.status,
        channel: opts.channel,
      },
    },
    {
      allowLlm: llmAllowed,
      knownNames: knownNamesFor(caseRow, victimProfile?.full_name),
    }
  );

  // ── 3. behavioural channel ────────────────────────────────────────────────
  let engagement: EngagementResult | null = null;
  try {
    engagement = await computeEngagement(
      opts.caseId,
      { id: opts.checkinId, raw_transcript: opts.transcript },
      opts.engagementMetrics ?? {}
    );
  } catch (err) {
    console.warn("[engagement] skipped", err instanceof Error ? err.message : err);
  }

  // ── 4. voice channel — whatever the voice pipeline already wrote ──────────
  const { data: voiceRows } = await safeQuery<VoiceAnalysisInput[]>("voice_analyses:checkin", () =>
    supabaseAdmin
      .from("voice_analyses")
      .select(
        "vocal_stress_index, baseline_deviation, confidence, f0_mean, jitter_local, shimmer_local, hnr_db, speech_rate, pause_ratio"
      )
      .eq("checkin_id", opts.checkinId)
      .order("created_at", { ascending: false })
      .limit(1)
  );
  const voice = voiceRows?.[0] ?? null;

  // ── 5. clinical channel ───────────────────────────────────────────────────
  const clinicalWindowStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: assessments } = await safeQuery<ClinicalAssessmentInput[]>(
    "clinical_assessments:recent",
    () =>
      supabaseAdmin
        .from("clinical_assessments")
        .select("instrument, total_score, max_score, severity_band, positive_screen, created_at")
        .eq("case_id", opts.caseId)
        .gte("created_at", clinicalWindowStart)
        .order("created_at", { ascending: false })
        .limit(20)
  );

  // ── 6. crisis override — on the RAW transcript, before composition ────────
  const crisis = detectCrisis(
    opts.transcript,
    scoreResult.signals_detected ?? [],
    (assessments ?? []) as CrisisAssessmentInput[]
  );

  // ── 7. compose ────────────────────────────────────────────────────────────
  const composite: CompositeResult = composeDistressScore({
    text: {
      score: scoreResult.score,
      reasoning: scoreResult.reasoning,
      signals: scoreResult.signals_detected ?? [],
    },
    clinical: assessments ?? null,
    voice,
    behavioural: engagement
      ? {
          engagement_score: engagement.engagement_score,
          penalties: engagement.penalties,
          prior_checkin_count: engagement.prior_checkin_count,
        }
      : null,
    context: {
      caseType: caseRow.case_type,
      caseStatus: caseRow.status,
      nextHearingDate: caseRow.next_hearing_date ?? null,
      reliefDueDate: caseRow.relief_due_date ?? null,
      reliefAmountSanctioned: caseRow.relief_amount_sanctioned ?? null,
      reliefAmountDisbursed: caseRow.relief_amount_disbursed ?? null,
      lastContactAt: caseRow.last_contact_at ?? null,
      daysSinceLastContact: daysSinceLast,
    },
    crisis,
  });

  const finalScore = composite.score;
  const finalRisk = composite.risk_level;

  const intel = computeDistressIntelligence(
    { score: finalScore, risk_level: finalRisk },
    recent_history,
    scoreResult.signals_detected ?? []
  );

  const trend_direction = scoreResult.trend_direction ?? intel.trend_direction;
  const escalation_risk_7d = composite.crisis_override
    ? 95
    : Math.max(scoreResult.escalation_risk_7d ?? 0, intel.escalation_risk_7d);

  const contributing_factors = [
    ...new Set([
      ...(scoreResult.contributing_factors ?? []),
      ...intel.contributing_factors,
      ...composite.contributions.filter((c) => c.contribution > 0).map((c) => c.feature),
    ]),
  ];

  // ── 8. statutory interventions ────────────────────────────────────────────
  const reliefSanctioned = caseRow.relief_amount_sanctioned ?? null;
  const reliefDisbursed = caseRow.relief_amount_disbursed ?? 0;
  const reliefOverdue = Boolean(
    caseRow.relief_due_date &&
      new Date(caseRow.relief_due_date).getTime() < Date.now() &&
      reliefSanctioned != null &&
      reliefDisbursed < reliefSanctioned
  );

  let poa: InterventionMatch[] = [];
  try {
    poa = await recommendInterventions({
      caseId: opts.caseId,
      caseType: caseRow.case_type,
      caseStatus: caseRow.status,
      risk: finalRisk,
      escalation: escalation_risk_7d,
      signals: scoreResult.signals_detected ?? [],
      reliefOverdue,
      reliefShortfall: reliefOverdue && reliefSanctioned != null ? reliefSanctioned - reliefDisbursed : null,
      crisisOverride: composite.crisis_override,
    });
  } catch (err) {
    console.warn("[interventions] skipped", err instanceof Error ? err.message : err);
  }

  const interventions = poa.map((p) => ({
    type: p.support_type,
    description: `${p.summary}. ${p.rationale}`,
  }));

  // ── 9. persist the score ──────────────────────────────────────────────────
  const reasoningParts = [
    composite.crisis_override
      ? `CRISIS OVERRIDE: ${composite.crisis_override_reason}`
      : scoreResult.reasoning,
    `Composite ${composite.composite_version} over ${composite.active_channels.map((c) => c.channel).join(" + ")}`,
  ];
  if (composite.absent_channels.length) reasoningParts.push(composite.redistribution_note);
  if (!scoreResult.llm_used && scoreResult.llm_skipped_reason?.startsWith("consent_revoked")) {
    reasoningParts.push(
      "AI processing consent was withheld, so this score came from transparent rules only."
    );
  }
  const reasoning = reasoningParts.join(" | ");

  const insertPayload: Record<string, unknown> = {
    checkin_id: opts.checkinId,
    case_id: opts.caseId,
    score: finalScore,
    risk_level: finalRisk,
    reasoning,
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
    model_confidence: composite.crisis_override ? "high" : scoreResult.model_confidence ?? "medium",
    prediction_method: scoreResult.prediction_method ?? intel.prediction_method,
    component_clinical: composite.components.clinical,
    component_text: composite.components.text,
    component_voice: composite.components.voice,
    component_behavioural: composite.components.behavioural,
    component_context: composite.components.context,
    active_channels: composite.active_channels,
    composite_version: composite.composite_version,
    crisis_override: composite.crisis_override,
    crisis_override_reason: composite.crisis_override_reason,
  };

  const { data: saved } = await safeInsertWithFallback<Record<string, unknown> & { id: string }>(
    "distress_scores:insert",
    insertPayload,
    ["checkin_id", "case_id", "score", "risk_level", "reasoning", "signals_detected"],
    (row) => supabaseAdmin.from("distress_scores").insert(row).select().single()
  );

  if (!saved) throw new Error("Failed to save distress score");

  // Attribute source for victim-dashboard analytics (chat | call | manual)
  const source =
    opts.channel === "ai_voice" || opts.channel === "ivrs" || opts.channel === "helpline"
      ? "call"
      : opts.channel === "chat" || opts.channel === "chatbot" || opts.channel === "app"
        ? "chat"
        : "chat";
  await safeQuery("distress_scores:source", () =>
    supabaseAdmin.from("distress_scores").update({ source }).eq("id", saved.id)
  );

  // Auto-allot consultant on first distress score
  try {
    const { maybeAllotConsultant } = await import("./consultant-allotment");
    await maybeAllotConsultant(opts.victimId);
  } catch (err) {
    console.warn("[allotment] skipped", err instanceof Error ? err.message : err);
  }

  // ── 10. XAI contributions ─────────────────────────────────────────────────
  if (composite.contributions.length) {
    await safeQuery("score_contributions:insert", () =>
      supabaseAdmin
        .from("score_contributions")
        .insert(
          composite.contributions.map((c) => ({
            distress_score_id: saved.id,
            channel: c.channel,
            feature: c.feature,
            feature_label: c.feature_label,
            raw_value: c.raw_value,
            weight: c.weight,
            contribution: c.contribution,
            direction: c.direction,
            evidence: c.evidence,
          }))
        )
        .select("id")
    );
  }

  const persistedRecommendations = poa.length
    ? await persistRecommendations(opts.caseId, poa)
    : [];

  // ── 11. cadence ───────────────────────────────────────────────────────────
  let cadence = null;
  try {
    cadence = await upsertCadenceAfterScore({
      caseId: opts.caseId,
      risk: finalRisk,
      escalation: escalation_risk_7d,
      stableCheckinCount: countStableCheckins([
        { risk_level: finalRisk },
        ...recent_history,
      ]),
      caseRow: {
        id: opts.caseId,
        status: caseRow.status,
        next_hearing_date: caseRow.next_hearing_date ?? null,
        relief_due_date: caseRow.relief_due_date ?? null,
        relief_amount_sanctioned: reliefSanctioned,
        relief_amount_disbursed: reliefDisbursed,
      },
      io: opts.io,
    });
  } catch (err) {
    console.warn("[cadence] skipped", err instanceof Error ? err.message : err);
  }

  // A check-in answers whatever contact was outstanding — silence is only a
  // signal if we correctly notice when it ends.
  try {
    if (opts.outreachId) {
      await markOutreachResponded(opts.outreachId, opts.checkinId, opts.io);
    } else {
      const { data: pending } = await safeQuery<{ id: string }[]>("outreach_schedule:pending", () =>
        supabaseAdmin
          .from("outreach_schedule")
          .select("id")
          .eq("case_id", opts.caseId)
          .in("status", ["sent", "scheduled"])
          .lte("scheduled_for", new Date().toISOString())
          .order("scheduled_for", { ascending: true })
          .limit(1)
      );
      if (pending?.[0]) await markOutreachResponded(pending[0].id, opts.checkinId, opts.io);
    }
  } catch (err) {
    console.warn("[outreach] response link skipped", err instanceof Error ? err.message : err);
  }

  // ── 12. alerts ────────────────────────────────────────────────────────────
  const shouldAlert =
    composite.crisis_override ||
    finalRisk === "high" ||
    finalRisk === "critical" ||
    escalation_risk_7d >= 70;

  const recommended_action = composite.crisis_override
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
      // A crisis override always alerts — the 1h dedup does not apply to it.
      if (existing?.length && !composite.crisis_override) continue;

      const severity: RiskLevel =
        composite.crisis_override || finalRisk === "critical" ? "critical" : "high";

      const { data: alertRow } = await supabaseAdmin
        .from("alerts")
        .insert({
          case_id: opts.caseId,
          distress_score_id: saved.id,
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
            reasoning,
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
    event_type: composite.crisis_override ? "crisis_override" : "checkin_completed",
    description: `Score ${finalScore} (${finalRisk}); trend ${trend_direction}; esc ${escalation_risk_7d}`,
    created_by: opts.victimId,
  });

  // ── 12b. attrition + victim confidence (persisted on the case) ───────────
  try {
    const { computeAttritionRisk } = await import("./attrition");
    const { computeVictimConfidence } = await import("./confidence-index");
    const threatHits = (scoreResult.signals_detected ?? []).filter((s) =>
      /threat|intimidation|fear_for_safety|hostile/i.test(s)
    ).length;
    const attrition = computeAttritionRisk({
      caseRow: {
        status: caseRow.status,
        created_at: caseRow.created_at,
        fir_date: caseRow.fir_date ?? null,
        incident_date: caseRow.incident_date ?? null,
        accused_bail_status: caseRow.accused_bail_status ?? null,
        bail_granted_date: caseRow.bail_granted_date ?? null,
        accused_village_same_as_victim: caseRow.accused_village_same_as_victim ?? null,
        protection_order_active: caseRow.protection_order_active ?? null,
        protection_requested: caseRow.protection_requested ?? null,
        relief_amount_sanctioned: caseRow.relief_amount_sanctioned ?? null,
        relief_amount_disbursed: caseRow.relief_amount_disbursed ?? null,
        relief_due_date: caseRow.relief_due_date ?? null,
        adjournment_count: caseRow.adjournment_count ?? null,
      },
      latestScore: {
        score: finalScore,
        risk_level: finalRisk,
        threat_score: Math.min(100, threatHits * 40),
      },
      recentScores: [
        { score: finalScore, risk_level: finalRisk },
        ...recent_history.map((h) => ({ score: h.score, risk_level: h.risk_level })),
      ],
      engagement,
      missedOutreach: engagement?.metrics.missed_outreach_count_30d ?? 0,
    });
    const confidence = computeVictimConfidence({
      caseRow: {
        relief_amount_sanctioned: caseRow.relief_amount_sanctioned ?? null,
        relief_amount_disbursed: caseRow.relief_amount_disbursed ?? null,
        adjournment_count: caseRow.adjournment_count ?? null,
        created_at: caseRow.created_at,
        status: caseRow.status,
      },
      engagementContinuity: {
        score: engagement?.engagement_score ?? 50,
      },
    });
    await safeQuery("cases:attrition_confidence", () =>
      supabaseAdmin
        .from("cases")
        .update({
          attrition_risk: attrition.score,
          victim_confidence_index: confidence.score,
        })
        .eq("id", opts.caseId)
    );
  } catch (err) {
    console.warn("[attrition/confidence] skipped", err instanceof Error ? err.message : err);
  }

  // ── 13. audit ─────────────────────────────────────────────────────────────
  await recordAudit({
    actorId: opts.victimId,
    actorRole: "victim",
    action: composite.crisis_override ? "crisis_override_raised" : "distress_score_computed",
    resourceType: "distress_score",
    resourceId: saved.id,
    caseId: opts.caseId,
    purpose: "automated distress triage on victim check-in",
    metadata: {
      score: finalScore,
      risk_level: finalRisk,
      composite_version: composite.composite_version,
      active_channels: composite.active_channels.map((c) => c.channel),
      llm_used: scoreResult.llm_used,
      redaction_entities: scoreResult.redaction.entity_count,
      alerts_created: alerts.length,
    },
  });

  return {
    distressScore: {
      ...saved,
      score: finalScore,
      risk_level: finalRisk,
      trend_direction,
      escalation_risk_7d,
      recommended_interventions: interventions,
      contributing_factors,
      crisis_override: composite.crisis_override,
      crisis_override_reason: composite.crisis_override_reason,
      component_clinical: composite.components.clinical,
      component_text: composite.components.text,
      component_voice: composite.components.voice,
      component_behavioural: composite.components.behavioural,
      component_context: composite.components.context,
      active_channels: composite.active_channels,
      composite_version: composite.composite_version,
    },
    alert: alerts[0] ?? null,
    alerts,
    scoreResult,
    composite,
    poa,
    persistedRecommendations,
    engagement,
    cadence,
    consent: { llm_processing: llmAllowed },
    redaction: scoreResult.redaction,
    intelligence: {
      trend_direction,
      escalation_risk_7d,
      contributing_factors,
      priority_hint: recommended_action,
      composite_version: COMPOSITE_VERSION,
      active_channels: composite.active_channels.map((c) => c.channel),
      absent_channels: composite.absent_channels,
      redistribution_note: composite.redistribution_note,
      crisis_override: composite.crisis_override,
      crisis_override_reason: composite.crisis_override_reason,
      engagement_score: engagement?.engagement_score ?? null,
      cadence_tier: cadence?.tier ?? null,
      next_outreach_at: cadence?.next_outreach_at ?? null,
    },
  };
}

export async function createCheckinAndScore(opts: {
  caseId: string;
  victimId: string;
  transcript: string;
  channel: CheckinChannel;
  io?: SocketServer;
  engagementMetrics?: EngagementClientMetrics;
  outreachId?: string | null;
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
    engagementMetrics: opts.engagementMetrics,
    outreachId: opts.outreachId,
  });

  return { checkin, ...result };
}
