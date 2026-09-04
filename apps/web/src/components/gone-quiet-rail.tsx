"use client";

import Link from "next/link";

export type GoneQuietItem = {
  id: string;
  case_number: string;
  missed_count?: number;
  consecutive_missed?: number;
  days_since_contact?: number | null;
  case_type?: string;
};

export function GoneQuietRail({ items }: { items: GoneQuietItem[] }) {
  if (!items.length) {
    return (
      <p className="px-3 py-4 text-sm text-muted-cmd">
        No disengaged cases right now — silence stays watched.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-hairline">
      {items.map((g) => {
        const misses = g.missed_count ?? g.consecutive_missed ?? 0;
        const days = g.days_since_contact;
        return (
          <li key={g.id}>
            <Link
              href={`/counselor/cases/${g.id}`}
              className="flex items-center justify-between gap-3 px-3 py-2.5 transition hover:bg-raised"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-cyan">{g.case_number}</p>
                <p className="truncate text-xs text-faint">{g.case_type ?? "atrocity case"}</p>
              </div>
              <div className="shrink-0 text-right font-mono text-xs">
                <p className="text-violet">{misses} miss{misses === 1 ? "" : "es"}</p>
                {days != null && <p className="text-faint">{Math.round(days)}d quiet</p>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
