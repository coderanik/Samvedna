import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { safeQuery } from "../lib/db-safe";
import { canAccessCase, fetchCaseForAccess } from "../lib/case-access";
import { auditMiddleware } from "../lib/audit";
import {
  CHANNEL_BASE_WEIGHTS,
  CHANNEL_LABELS,
  COMPOSITE_BASE,
  COMPOSITE_VERSION,
  recomposeFromChannels,
  type CompositeChannel,
  type ContributionDirection,
} from "../lib/composite-score";

interface ContributionRow {
  id: string;
  channel: string;
  feature: string;
  feature_label: string | null;
  raw_value: number | null;
  weight: number | null;
  contribution: number | null;
  direction: string | null;
  evidence: string | null;
}

/** Which distress_scores column holds each channel's own sub-score. */
const COMPONENT_COLUMNS: Record<CompositeChannel, string> = {
  clinical: "component_clinical",
  text_sentiment: "component_text",
  vocal_stress: "component_voice",
  behavioural: "component_behavioural",
  case_context: "component_context",
};

const WHAT_THIS_IS_NOT = [
  "This is triage support for an authorised human, not a clinical diagnosis. No mental-health condition is being asserted, and nothing here substitutes for assessment by a qualified professional.",
  "The attribution below is exact composite arithmetic, not a post-hoc model rationalisation: the score is literally the base plus the listed contributions, so every point is traceable to a named feature.",
  "Weights are a policy choice made by this project, not an empirically validated clinical instrument. They have not been calibrated against outcomes.",
  "Absent channels were not scored as zero. Their weight was redistributed across the channels that did report, so a missing voice sample never looks like calm.",
];

function isCompositeChannel(value: string): value is CompositeChannel {
  return value in CHANNEL_BASE_WEIGHTS;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function explainRouter() {
  const router = Router();

  router.get(
    "/:caseId/scores/:scoreId/explain",
    requireAuth,
    auditMiddleware("distress_score_explained", "distress_score"),
    async (req, res, next) => {
      try {
        const caseRow = await fetchCaseForAccess(req.params.caseId);
        if (!caseRow) return res.status(404).json({ error: "Case not found" });
        if (!canAccessCase(req.user!.role, req.user!.id, caseRow)) {
          return res.status(403).json({ error: "Access denied" });
        }
        if (req.user!.role === "victim") {
          return res.status(403).json({ error: "Explanations are for care teams only" });
        }

        const { data: score } = await supabaseAdmin
          .from("distress_scores")
          .select("*")
          .eq("id", req.params.scoreId)
          .eq("case_id", req.params.caseId)
          .maybeSingle();
        if (!score) return res.status(404).json({ error: "Score not found" });

        const { data: contributionRows } = await safeQuery<ContributionRow[]>(
          "score_contributions:explain",
          () =>
            supabaseAdmin
              .from("score_contributions")
              .select("*")
              .eq("distress_score_id", score.id)
              .order("contribution", { ascending: false })
        );

        const contributions = contributionRows ?? [];

        // ── rebuild the channels from the stored arithmetic ──────────────────
        const grouped = new Map<CompositeChannel, ContributionRow[]>();
        for (const row of contributions) {
          if (!isCompositeChannel(row.channel)) continue;
          const list = grouped.get(row.channel) ?? [];
          list.push(row);
          grouped.set(row.channel, list);
        }

        const channels = [...grouped.entries()].map(([channel, rows]) => {
          const weight = rows.find((r) => (r.weight ?? 0) > 0)?.weight ?? CHANNEL_BASE_WEIGHTS[channel];
          const contribution = rows.reduce((a, r) => a + (r.contribution ?? 0), 0);
          // score = base + contribution / weight is the inverse of how the
          // contribution was produced, so this is a reconstruction, not a guess.
          const channelScore =
            weight > 0
              ? Math.round(COMPOSITE_BASE + contribution / weight)
              : Math.round(Number(score[COMPONENT_COLUMNS[channel]] ?? COMPOSITE_BASE));

          return {
            channel,
            label: CHANNEL_LABELS[channel],
            weight: Math.round(weight * 1000) / 1000,
            base_weight: CHANNEL_BASE_WEIGHTS[channel],
            score: Math.max(0, Math.min(100, channelScore)),
            contribution: round1(contribution),
            features: rows.map((r) => ({
              feature: r.feature,
              feature_label: r.feature_label ?? r.feature,
              raw_value: r.raw_value,
              contribution: round1(r.contribution ?? 0),
              direction: (r.direction ?? "neutral") as ContributionDirection,
              evidence: r.evidence ?? "",
            })),
          };
        });

        channels.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

        const topFactors = contributions
          .filter((r) => Math.abs(r.contribution ?? 0) > 0.5 && !r.feature.endsWith("_baseline"))
          .sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0))
          .slice(0, 5)
          .map((r) => ({
            feature: r.feature,
            feature_label: r.feature_label ?? r.feature,
            channel: r.channel,
            contribution: round1(r.contribution ?? 0),
            direction: (r.direction ?? "neutral") as ContributionDirection,
            evidence: r.evidence ?? "",
          }));

        // ── counterfactuals against this person's own baselines ─────────────
        const { data: history } = await supabaseAdmin
          .from("distress_scores")
          .select(
            "component_clinical, component_text, component_voice, component_behavioural, component_context, created_at"
          )
          .eq("case_id", req.params.caseId)
          .lt("created_at", score.created_at)
          .order("created_at", { ascending: false })
          .limit(10);

        const channelScores = channels.map((c) => ({ channel: c.channel, score: c.score }));

        const counterfactuals = channels.slice(0, 2).map((channel) => {
          const column = COMPONENT_COLUMNS[channel.channel];
          const priorValues = (history ?? [])
            .map((h) => (h as Record<string, unknown>)[column])
            .filter((v): v is number => typeof v === "number");

          const baseline = priorValues.length
            ? Math.round(priorValues.reduce((a, b) => a + b, 0) / priorValues.length)
            : COMPOSITE_BASE;

          const counterfactualScore = recomposeFromChannels(channelScores, {
            channel: channel.channel,
            score: baseline,
          });

          return {
            channel: channel.channel,
            label: channel.label,
            observed_channel_score: channel.score,
            baseline_channel_score: baseline,
            baseline_source: priorValues.length
              ? `mean of this person's own last ${priorValues.length} recorded ${channel.label.toLowerCase()} readings`
              : "no personal history for this channel yet, so the neutral midpoint was used",
            counterfactual_score: counterfactualScore,
            delta: round1(score.score - counterfactualScore),
            statement: `If ${channel.label.toLowerCase()} were back at ${baseline}/100, the composite would be ${counterfactualScore} instead of ${score.score}.`,
          };
        });

        // ── simple counterfactual for behavioural channel if it contributed ──
        const behaviouralChannel = channels.find((c) => c.channel === "behavioural");
        const behaviouralContribution = behaviouralChannel?.contribution ?? 0;
        let behaviouralCounterfactual: string | null = null;
        if (Math.abs(behaviouralContribution) > 5) {
          const hypotheticalScore = Math.round(score.score - behaviouralContribution);
          behaviouralCounterfactual = `If engagement returned to baseline, the score would fall to approximately ${hypotheticalScore}/100.`;
        }

        // ── channel agreement note ─────────────────────────────────────────
        const channelScoresNormalized = channels
          .filter((c) => c.channel !== "case_context") // case_context is static, ignore for agreement
          .map((c) => c.score);
        const meanScore =
          channelScoresNormalized.length > 0
            ? channelScoresNormalized.reduce((a, b) => a + b, 0) / channelScoresNormalized.length
            : 0;
        const variance =
          channelScoresNormalized.length > 0
            ? channelScoresNormalized.reduce((a, b) => a + Math.pow(b - meanScore, 2), 0) /
              channelScoresNormalized.length
            : 0;
        const stdDev = Math.sqrt(variance);
        const channelAgreement =
          stdDev < 10
            ? "high — all channels point to similar distress"
            : stdDev < 20
              ? "moderate — channels mostly align"
              : "low — channels diverge, consider which signal is most reliable";

        const arithmeticCheck = round1(
          COMPOSITE_BASE + contributions.reduce((a, r) => a + (r.contribution ?? 0), 0)
        );

        res.json({
          score: score.score,
          risk_level: score.risk_level,
          crisis_override: score.crisis_override ?? false,
          crisis_override_reason: score.crisis_override_reason ?? null,
          base: COMPOSITE_BASE,
          channels,
          top_factors: topFactors,
          counterfactuals,
          behavioural_counterfactual: behaviouralCounterfactual,
          channel_agreement: channelAgreement,
          model_confidence: score.model_confidence ?? null,
          composite_version: score.composite_version ?? COMPOSITE_VERSION,
          active_channels: score.active_channels ?? null,
          what_this_is_not: WHAT_THIS_IS_NOT,
          arithmetic_check: {
            base_plus_contributions: arithmeticCheck,
            stored_score: score.score,
            /** Off by at most rounding on the individual contributions. */
            agrees: Math.abs(arithmeticCheck - score.score) <= 1.5,
          },
          degraded: contributions.length === 0,
          // Retained for the existing counsellor UI, which renders these directly.
          contributions,
          arithmetic_note:
            "This explanation is the same weighted composite arithmetic that produced the score — not a second model rationalising the first.",
          disclaimer:
            "Triage decision-support for authorised professionals. Not a clinical diagnosis.",
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
