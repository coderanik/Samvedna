"use client";

import { cn } from "@/lib/utils";

const RISK: Record<string, string> = {
  low: "bg-emerald-500/15 text-emerald-800 border-emerald-500/30",
  moderate: "bg-amber-500/15 text-amber-900 border-amber-500/30",
  high: "bg-orange-500/15 text-orange-900 border-orange-500/30",
  critical: "bg-red-600/15 text-red-800 border-red-600/40",
};

const TREND: Record<string, string> = {
  rising: "text-red-700",
  stable: "text-slate-600",
  improving: "text-emerald-700",
};

export function RiskBadge({
  level,
  score,
  className,
}: {
  level: string;
  score?: number | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        RISK[level] ?? RISK.moderate,
        className
      )}
    >
      <span aria-hidden>{level === "critical" ? "●" : level === "high" ? "●" : "○"}</span>
      {level}
      {typeof score === "number" ? ` · ${score}` : ""}
    </span>
  );
}

export function TrendBadge({ trend }: { trend?: string | null }) {
  if (!trend) return null;
  const label =
    trend === "rising" ? "↑ Rising" : trend === "improving" ? "↓ Improving" : "→ Stable";
  return (
    <span className={cn("text-xs font-semibold", TREND[trend] ?? TREND.stable)}>{label}</span>
  );
}
