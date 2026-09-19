import { supabaseAdmin } from "./supabase";
import { extractProblemTags } from "./chat-tags";
import { summariseCallTranscript } from "./call-summary";

export type BriefingSource = "chat" | "call" | "voice";

export async function computeAverageDistress(caseIds: string[]): Promise<{
  average: number | null;
  count: number;
  latest: number | null;
}> {
  if (!caseIds.length) return { average: null, count: 0, latest: null };

  const { data } = await supabaseAdmin
    .from("distress_scores")
    .select("score, created_at")
    .in("case_id", caseIds)
    .order("created_at", { ascending: false });

  const scores = (data ?? []).map((r) => Number(r.score)).filter((n) => Number.isFinite(n));
  if (!scores.length) return { average: null, count: 0, latest: null };

  const sum = scores.reduce((a, b) => a + b, 0);
  return {
    average: Math.round(sum / scores.length),
    count: scores.length,
    latest: scores[0] ?? null,
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => (v ?? "").trim().toLowerCase()).filter(Boolean))];
}

/**
 * Build a counsellor-facing briefing and push it to consultant_updates
 * (and the most recent open meet.report when present).
 */
export async function pushConsultantBriefing(opts: {
  victimId: string;
  caseId: string;
  source: BriefingSource;
  transcript: string;
  summary?: string | null;
  distressScore: number;
  riskLevel: string;
  emotionIndicators?: string[];
  clientEmotions?: string[];
  keywords?: string[];
  signals?: string[];
  reasoning?: string | null;
}): Promise<{ average: number | null; message: string | null }> {
  const { data: cases } = await supabaseAdmin
    .from("cases")
    .select("id")
    .eq("victim_id", opts.victimId);
  const caseIds = (cases ?? []).map((c) => c.id);
  const avg = await computeAverageDistress(caseIds.length ? caseIds : [opts.caseId]);

  const tags = extractProblemTags(opts.transcript);
  const emotions = uniqueStrings([
    ...(opts.emotionIndicators ?? []),
    ...(opts.clientEmotions ?? []),
    ...tags,
  ]);
  const keywords = uniqueStrings([...(opts.keywords ?? []), ...tags]).slice(0, 14);
  const signals = uniqueStrings(opts.signals ?? []).slice(0, 10);

  const channelLabel =
    opts.source === "chat" ? "chat check-in" : opts.source === "voice" ? "ElevenLabs voice call" : "voice call";

  const summary =
    opts.summary?.trim() ||
    (await summariseCallTranscript(opts.transcript, "en").catch(() => null)) ||
    "Interaction captured; review transcript signals below.";

  const lines = [
    `New ${channelLabel} briefing`,
    `Session distress: ${opts.distressScore}/100 (${opts.riskLevel})`,
    avg.average != null
      ? `Running average across ${avg.count} chat/call check-ins: ${avg.average}/100`
      : null,
    emotions.length ? `Emotions / themes: ${emotions.join(", ")}` : null,
    keywords.length ? `Keywords: ${keywords.join(", ")}` : null,
    signals.length ? `Model signals: ${signals.join(", ")}` : null,
    opts.reasoning ? `Notes: ${opts.reasoning.slice(0, 320)}` : null,
    `Survivor-facing summary: ${summary.slice(0, 400)}`,
  ].filter(Boolean);

  const message = lines.join(" · ");

  const { data: assignment } = await supabaseAdmin
    .from("consultant_assignments")
    .select("consultant_id")
    .eq("user_id", opts.victimId)
    .maybeSingle();

  if (assignment?.consultant_id) {
    await supabaseAdmin.from("consultant_updates").insert({
      user_id: opts.victimId,
      consultant_id: assignment.consultant_id,
      event_type: "wellbeing_briefing",
      message,
    });

    const { data: openMeet } = await supabaseAdmin
      .from("consultant_meets")
      .select("id, report")
      .eq("user_id", opts.victimId)
      .eq("consultant_id", assignment.consultant_id)
      .in("status", ["scheduled", "in_progress"])
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (openMeet) {
      const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      const prior = (openMeet.report as string | null)?.trim();
      const block = `[${stamp}]\n${lines.join("\n")}`;
      await supabaseAdmin
        .from("consultant_meets")
        .update({
          report: prior ? `${prior}\n\n---\n\n${block}` : block,
        })
        .eq("id", openMeet.id);
    }
  }

  return { average: avg.average, message: assignment ? message : null };
}
