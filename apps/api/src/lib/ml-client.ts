import type { DistressScoreResult, ScoreCheckinPayload } from "@samvedna/shared-types";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

export async function scoreCheckin(payload: ScoreCheckinPayload): Promise<DistressScoreResult> {
  const res = await fetch(`${ML_SERVICE_URL}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ML service error (${res.status}): ${text}`);
  }

  return res.json() as Promise<DistressScoreResult>;
}
