"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import { connectSocket, onNewAlert } from "@/lib/socket";
import { apiFetch } from "@/lib/utils";
import type { NewAlertEvent, RiskLevel, UserRole } from "@samvedna/shared-types";

type AlertApiRow = {
  id: string;
  case_id: string;
  distress_score_id: string;
  severity: RiskLevel;
  status: string;
  assigned_to: string;
  created_at: string;
  resolved_at: string | null;
  case?: {
    case_number?: string;
    victim?: { full_name?: string };
  };
};

function toToastEvent(row: AlertApiRow): NewAlertEvent {
  return {
    alert: {
      id: row.id,
      case_id: row.case_id,
      distress_score_id: row.distress_score_id,
      severity: row.severity,
      status: row.status as NewAlertEvent["alert"]["status"],
      assigned_to: row.assigned_to,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
    },
    case_id: row.case_id,
    case_number: row.case?.case_number ?? "Case",
    victim_name: row.case?.victim?.full_name ?? "Survivor",
    severity: row.severity,
    reasoning: "Open distress alert — review case intelligence.",
  };
}

function caseHref(role: UserRole | undefined, caseId: string) {
  if (role === "official" || role === "admin") return "/admin#alerts";
  return `/counselor/cases/${caseId}`;
}

export function AlertToast({
  userId,
  token,
  role,
}: {
  userId: string;
  token?: string;
  role?: UserRole;
}) {
  const [alerts, setAlerts] = useState<NewAlertEvent[]>([]);

  useEffect(() => {
    connectSocket(userId);
    return onNewAlert((event) => {
      setAlerts((prev) => {
        if (prev.some((p) => p.alert.id === event.alert.id)) return prev;
        return [event, ...prev].slice(0, 4);
      });
    });
  }, [userId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiFetch<AlertApiRow[]>("/alerts", { token });
        if (cancelled) return;
        const open = rows
          .filter(
            (r) =>
              (r.status === "open" || r.status === "acknowledged") &&
              (r.severity === "high" || r.severity === "critical")
          )
          .slice(0, 4)
          .map(toToastEvent);
        setAlerts((prev) => {
          const byId = new Map<string, NewAlertEvent>();
          for (const a of [...open, ...prev]) byId.set(a.alert.id, a);
          return Array.from(byId.values()).slice(0, 4);
        });
      } catch {
        /* toast is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!alerts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(100vw-2rem,24rem)] flex-col gap-2">
      {alerts.map((a, i) => (
        <div
          key={a.alert.id}
          className="pointer-events-auto flex items-start gap-3 rounded-xl border border-red-500/35 bg-card p-4 shadow-xl animate-in slide-in-from-right fade-in"
          role="alert"
        >
          <div
            className={
              a.severity === "critical"
                ? "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600/15"
                : "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500/15"
            }
          >
            <AlertTriangle
              className={
                a.severity === "critical" ? "h-4 w-4 text-red-600" : "h-4 w-4 text-orange-600"
              }
            />
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold capitalize text-foreground">
              {a.severity} distress alert
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {a.case_number}
              {a.victim_name ? ` · ${a.victim_name}` : ""}
            </p>
            {a.trend_direction && (
              <p className="mt-1 text-xs font-medium">Trend: {a.trend_direction}</p>
            )}
            {a.escalation_risk_7d != null && (
              <p className="text-xs">Escalation risk: {a.escalation_risk_7d}/100</p>
            )}
            {a.reasoning && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.reasoning}</p>
            )}
            {a.recommended_action && (
              <p className="mt-2 text-xs font-semibold text-primary">{a.recommended_action}</p>
            )}
            <Link
              href={caseHref(role, a.case_id)}
              className="mt-2 inline-block text-xs font-semibold text-primary underline"
            >
              {role === "admin" || role === "official"
                ? "Open alerts →"
                : "Open case intelligence →"}
            </Link>
          </div>
          <button
            type="button"
            aria-label="Dismiss alert"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setAlerts((p) => p.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
