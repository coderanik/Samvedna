import { cn, RISK_COLORS } from "@/lib/utils";
import type { RiskLevel } from "@samvedna/shared-types";

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        RISK_COLORS[level]
      )}
    >
      {level}
      {score !== undefined && <span className="opacity-70">· {score}</span>}
    </span>
  );
}
