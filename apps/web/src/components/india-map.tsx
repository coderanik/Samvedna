"use client";

import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
// react-simple-maps types clash with this React version — cast for JSX.
import * as RSM from "react-simple-maps";

const ComposableMap = RSM.ComposableMap as React.FC<Record<string, unknown>>;
const Geographies = RSM.Geographies as React.FC<Record<string, unknown>>;
const Geography = RSM.Geography as React.FC<Record<string, unknown>>;
const Marker = RSM.Marker as React.FC<Record<string, unknown>>;

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

export type DistrictDatum = {
  state: string;
  district: string;
  mean_distress: number;
  lat?: number;
  lng?: number;
  cluster?: boolean;
};

/** National overview — India highlight + district markers. */
export function IndiaMap({
  districts,
  onSelectState,
}: {
  districts: DistrictDatum[];
  onSelectState?: (state: string | null) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const color = useMemo(
    () => scaleLinear<string>().domain([20, 80]).range(["#172029", "#ef4444"]),
    []
  );

  const markers = districts.filter((d) => d.lat != null && d.lng != null);

  return (
    <div className="w-full">
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [82, 23], scale: 900 }}
        width={800}
        height={520}
        className="h-auto w-full"
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: Array<{ rsmKey: string; properties: { name?: string } }> }) =>
            geographies.map((geo) => {
              const isIndia = geo.properties.name === "India";
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={isIndia ? "#172029" : "#0a0e13"}
                  stroke="#1f2b36"
                  strokeWidth={0.4}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none", fill: isIndia ? "#1f2b36" : "#0a0e13" },
                    pressed: { outline: "none" },
                  }}
                  onClick={() => {
                    if (!isIndia) return;
                    setActive(null);
                    onSelectState?.(null);
                  }}
                />
              );
            })
          }
        </Geographies>
        {markers.map((d) => (
          <Marker
            key={`${d.state}-${d.district}`}
            coordinates={[d.lng!, d.lat!]}
            onClick={() => {
              setActive(d.state);
              onSelectState?.(d.state);
            }}
          >
            <circle
              r={d.cluster ? 8 : 5}
              fill={color(d.mean_distress)}
              stroke={d.cluster ? "#a78bfa" : "#22d3ee"}
              strokeWidth={d.cluster ? 2 : 1}
              className={d.cluster ? "animate-pulse" : undefined}
            />
            <title>
              {d.district}, {d.state} — mean distress {Math.round(d.mean_distress)}
              {d.cluster ? " · cluster alert" : ""}
            </title>
          </Marker>
        ))}
      </ComposableMap>
      {active && (
        <p className="mt-2 font-mono text-xs text-cyan">
          Filtered to {active}
          <button
            type="button"
            className="ml-3 text-faint underline"
            onClick={() => {
              setActive(null);
              onSelectState?.(null);
            }}
          >
            clear
          </button>
        </p>
      )}
    </div>
  );
}
