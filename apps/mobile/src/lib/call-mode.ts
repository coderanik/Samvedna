import type { RiskLevel } from "@samvedna/shared-types";

export type MobileCallMode = "helpline" | "metal_ai";

/** High/critical → real helplines; low/moderate → Metal AI. */
export function callModeForRisk(risk: RiskLevel | null | undefined): MobileCallMode {
  if (risk === "high" || risk === "critical") return "helpline";
  return "metal_ai";
}

export function riskLabel(risk: RiskLevel | null | undefined): string {
  if (!risk) return "Unknown";
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}
