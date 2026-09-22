"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus, X } from "lucide-react";
import { connectSocket, onVictimAssigned } from "@/lib/socket";
import type { VictimAssignedEvent } from "@samvedna/shared-types";

export function NewAssignmentToast({ userId }: { userId: string }) {
  const [items, setItems] = useState<VictimAssignedEvent[]>([]);

  useEffect(() => {
    connectSocket(userId);
    return onVictimAssigned((event) => {
      setItems((prev) => {
        if (prev.some((p) => p.victim_id === event.victim_id && p.case_id === event.case_id)) {
          return prev;
        }
        return [event, ...prev].slice(0, 4);
      });
    });
  }, [userId]);

  if (!items.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[90] flex w-[min(100vw-2rem,24rem)] flex-col gap-2">
      {items.map((a) => (
        <div
          key={`${a.case_id}-${a.victim_id}`}
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-[var(--sanctuary-teal)]/35 bg-[var(--sanctuary-canvas)] p-4 shadow-xl animate-in slide-in-from-left fade-in"
          role="status"
        >
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--sanctuary-teal)]/15">
            <UserPlus className="h-4 w-4 text-[var(--sanctuary-teal)]" />
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-[var(--sanctuary-ink)]">New survivor allotted</p>
            <p className="mt-0.5 text-[var(--sanctuary-ink-2)]">
              {a.victim_name}
              {a.case_number ? ` · ${a.case_number}` : ""}
            </p>
            {a.distress_score != null && (
              <p className="mt-1 text-xs">
                Onboarding distress: {a.distress_score}
                {a.risk_level ? ` (${a.risk_level})` : ""}
              </p>
            )}
            <p className="mt-1 line-clamp-2 text-xs text-[var(--sanctuary-ink-3)]">{a.message}</p>
            <Link
              href={`/counselor/cases/${a.case_id}`}
              className="mt-2 inline-block text-xs font-semibold text-[var(--sanctuary-teal)] underline"
            >
              Open case →
            </Link>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() =>
              setItems((p) => p.filter((x) => !(x.case_id === a.case_id && x.victim_id === a.victim_id)))
            }
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
