"use client";

import { useEffect, useState } from "react";
import { connectSocket, onNewAlert } from "@/lib/socket";
import type { NewAlertEvent } from "@samvedna/shared-types";
import { AlertTriangle, X } from "lucide-react";
import Link from "next/link";

export function AlertToast({ userId }: { userId: string }) {
  const [alerts, setAlerts] = useState<NewAlertEvent[]>([]);

  useEffect(() => {
    connectSocket(userId);
    return onNewAlert((event) => {
      setAlerts((prev) => {
        if (prev.some((p) => p.alert.id === event.alert.id)) return prev;
        return [event, ...prev].slice(0, 3);
      });
    });
  }, [userId]);

  if (!alerts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-md flex-col gap-2">
      {alerts.map((a, i) => (
        <div
          key={a.alert.id}
          className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-card p-4 shadow-xl animate-in slide-in-from-right"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="flex-1 text-sm">
            <p className="font-semibold capitalize">
              {a.severity} alert — {a.case_number}
            </p>
            <p className="text-muted-foreground">{a.victim_name}</p>
            {a.trend_direction && (
              <p className="mt-1 text-xs font-medium">Trend: {a.trend_direction}</p>
            )}
            {a.escalation_risk_7d != null && (
              <p className="text-xs">Escalation risk (MVP): {a.escalation_risk_7d}/100</p>
            )}
            <p className="mt-1 line-clamp-2 text-xs">{a.reasoning}</p>
            {a.recommended_action && (
              <p className="mt-2 text-xs font-semibold text-primary">{a.recommended_action}</p>
            )}
            <Link
              href={`/counselor/cases/${a.case_id}`}
              className="mt-2 inline-block text-xs font-semibold text-primary underline"
            >
              Open case intelligence →
            </Link>
          </div>
          <button
            type="button"
            aria-label="Dismiss alert"
            onClick={() => setAlerts((p) => p.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ))}
    </div>
  );
}
