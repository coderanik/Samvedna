"use client";

import { useEffect, useState } from "react";
import { connectSocket, onNewAlert } from "@/lib/socket";
import type { NewAlertEvent } from "@samvedna/shared-types";
import { AlertTriangle, X } from "lucide-react";

export function AlertToast({ userId }: { userId: string }) {
  const [alerts, setAlerts] = useState<NewAlertEvent[]>([]);

  useEffect(() => {
    connectSocket(userId);
    return onNewAlert((event) => {
      setAlerts((prev) => [event, ...prev].slice(0, 3));
    });
  }, [userId]);

  if (!alerts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {alerts.map((a, i) => (
        <div
          key={a.alert.id}
          className="flex items-start gap-3 rounded-lg border border-risk-critical/30 bg-card p-4 shadow-lg animate-in slide-in-from-right"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-risk-critical" />
          <div className="flex-1 text-sm">
            <p className="font-semibold capitalize">{a.severity} alert — {a.case_number}</p>
            <p className="text-muted-foreground">{a.victim_name}</p>
            <p className="mt-1 line-clamp-2 text-xs">{a.reasoning}</p>
          </div>
          <button onClick={() => setAlerts((p) => p.filter((_, j) => j !== i))}>
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ))}
    </div>
  );
}
