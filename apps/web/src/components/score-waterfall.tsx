"use client";

/** Waterfall-style contribution list for Case Intelligence (Command theme). */
export function ScoreWaterfall({
  contributions,
}: {
  contributions: Array<{
    feature_label: string;
    contribution: number;
    direction: string;
    evidence: string;
    channel: string;
  }>;
}) {
  if (!contributions?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No contribution rows yet. Apply the v2 migration, then score a check-in.
      </p>
    );
  }

  const max = Math.max(...contributions.map((c) => Math.abs(Number(c.contribution) || 0)), 1);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Same arithmetic that produced the score — not a second model rationalising the first.
      </p>
      {contributions.map((c, i) => {
        const val = Number(c.contribution) || 0;
        const pct = Math.min(100, (Math.abs(val) / max) * 100);
        const up = c.direction === "increases" || val >= 0;
        return (
          <div key={`${c.feature_label}-${i}`}>
            <div className="mb-1 flex justify-between gap-2 text-xs">
              <span className="font-medium">
                {c.feature_label}{" "}
                <span className="text-muted-foreground">({c.channel})</span>
              </span>
              <span className="tabular-nums font-semibold">
                {up ? "+" : ""}
                {val.toFixed(1)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${up ? "bg-orange-500" : "bg-emerald-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{c.evidence}</p>
          </div>
        );
      })}
    </div>
  );
}
