"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ForecastPoint = {
  day: string | number;
  score?: number | null;
  predicted?: number | null;
  lower?: number | null;
  upper?: number | null;
};

/** History solid line into a shaded forecast cone; dashed crisis at 76. */
export function ForecastCone({
  data,
  honesty,
  risk7d,
  method,
}: {
  data: ForecastPoint[];
  honesty?: string;
  risk7d?: number | null;
  method?: string;
}) {
  if (!data.length) {
    return (
      <p className="text-sm text-[var(--sanctuary-ink-3)]">
        Forecast needs a short score history. Marked ARCHITECTED until seeded.
      </p>
    );
  }

  const ink = "var(--sanctuary-ink-3, #5c6b7a)";
  const teal = "var(--sanctuary-teal, #2a6f6f)";
  const sand = "var(--sanctuary-sand, #e8dcc8)";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        {risk7d != null && (
          <p className="text-sm text-[var(--sanctuary-ink-2)]">
            7-day escalation risk{" "}
            <span className="font-medium text-[var(--sanctuary-ink)]">{risk7d}%</span>
            {method ? (
              <span className="ml-2 text-[11px] text-[var(--sanctuary-ink-3)]">({method})</span>
            ) : null}
          </p>
        )}
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={sand} strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke={ink} tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} stroke={ink} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "var(--sanctuary-canvas, #fff)",
                border: `1px solid ${sand}`,
                borderRadius: 4,
                fontSize: 12,
              }}
            />
            <ReferenceLine
              y={76}
              stroke="var(--sanctuary-terracotta, #c97b5a)"
              strokeDasharray="4 4"
              label={{ value: "crisis", fill: ink, fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="upper"
              stroke="none"
              fill={teal}
              fillOpacity={0.15}
            />
            <Area
              type="monotone"
              dataKey="lower"
              stroke="none"
              fill="var(--sanctuary-canvas, #fff)"
              fillOpacity={1}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke="var(--sanctuary-ink, #1a1a1a)"
              fill="none"
              strokeWidth={2}
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="predicted"
              stroke={teal}
              fill="none"
              strokeWidth={2}
              strokeDasharray="4 4"
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {honesty && (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--sanctuary-ink-3)]">{honesty}</p>
      )}
    </div>
  );
}
