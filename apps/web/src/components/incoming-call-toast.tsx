"use client";

import { useEffect, useState } from "react";
import { connectSocket, onIncomingCall } from "@/lib/socket";
import type { IncomingCallEvent } from "@samvedna/shared-types";
import { Phone, X } from "lucide-react";

export function IncomingCallToast({ userId }: { userId: string }) {
  const [calls, setCalls] = useState<IncomingCallEvent[]>([]);

  useEffect(() => {
    connectSocket(userId);
    return onIncomingCall((event) => {
      setCalls((prev) => [event, ...prev].slice(0, 2));
    });
  }, [userId]);

  if (!calls.length) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex max-w-sm flex-col gap-2">
      {calls.map((c, i) => (
        <div
          key={c.call_session.id}
          className="flex items-start gap-3 rounded-lg border border-risk-high/40 bg-card p-4 shadow-lg"
        >
          <Phone className="mt-0.5 h-5 w-5 shrink-0 animate-pulse text-risk-high" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Incoming counsellor call</p>
            <p className="text-muted-foreground">
              {c.victim_name} · {c.case_number}
            </p>
            <p className="mt-1 text-xs capitalize">Risk: {c.call_session.risk_level_at_call}</p>
          </div>
          <button onClick={() => setCalls((p) => p.filter((_, j) => j !== i))}>
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ))}
    </div>
  );
}
