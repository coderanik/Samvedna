/**
 * Legacy wrapper. The deterministic crisis check now lives in composite-score.ts
 * next to the arithmetic it overrides; this keeps the older `{override, reason}`
 * shape for any caller that still expects it.
 */

import { detectCrisis } from "./composite-score";

export { detectCrisis } from "./composite-score";

export function detectCrisisLegacy(transcript: string): {
  override: boolean;
  reason: string | null;
} {
  const hit = detectCrisis(transcript);
  return hit ? { override: true, reason: hit.reason } : { override: false, reason: null };
}
