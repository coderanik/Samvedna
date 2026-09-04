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
}: {
  data: ForecastPoint[];
  honesty?: string;
}) {
  if (!data.length) {
    return (
      <p className="text-sm text-muted-cmd">
        Forecast needs a short score history. Marked ARCHITECTED until seeded.
      </p>
    );
  }

  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#1f2b36" strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke="#5c6b7a" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} stroke="#5c6b7a" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "#111820",
                border: "1px solid #1f2b36",
                borderRadius: 4,
                fontSize: 12,
              }}
            />
            <ReferenceLine y={76} stroke="#ef4444" strokeDasharray="4 4" label="crisis" />
            <Area
              type="monotone"
              dataKey="upper"
              stroke="none"
              fill="#22d3ee"
              fillOpacity={0.12}
            />
            <Area
              type="monotone"
              dataKey="lower"
              stroke="none"
              fill="#0a0e13"
              fillOpacity={1}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke="#e6edf3"
              fill="none"
              strokeWidth={2}
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="predicted"
              stroke="#22d3ee"
              fill="none"
              strokeWidth={2}
              strokeDasharray="4 4"
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {honesty && <p className="mt-2 text-[11px] leading-relaxed text-faint">{honesty}</p>}
    </div>
  );
}
