const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

/**
 * Summarise an AI / Twilio call transcript using the same ML companion stack.
 * Falls back to a short extractive summary if the service is unreachable.
 */
export async function summariseCallTranscript(
  transcript: string,
  preferredLanguage = "en"
): Promise<string> {
  const cleaned = transcript.trim();
  if (!cleaned) return "No conversation content was captured for this call.";

  const prompt = `Summarise this survivor support call in 3-4 short sentences for the survivor's private dashboard. Be warm, factual, and non-clinical. Do not invent details. Do not include distress scores or risk labels. Language: ${preferredLanguage}.\n\nTranscript:\n${cleaned.slice(0, 6000)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`${ML_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: prompt,
        preferred_language: preferredLanguage,
        conversation_history: [],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = (await res.json()) as { response?: string; reply?: string };
      const text = (data.response ?? data.reply ?? "").trim();
      if (text) return text;
    }
  } catch (err) {
    console.warn(
      "[call-summary] ML unavailable:",
      err instanceof Error ? err.message : err
    );
  }

  const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const preview = lines.slice(0, 3).join(" ");
  return `Call notes: ${preview.slice(0, 280)}${preview.length > 280 ? "…" : ""}`;
}
