"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { RiskBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import type { AlertStatus, RiskLevel } from "@samvedna/shared-types";

interface AlertRow {
  id: string;
  case_id: string;
  severity: RiskLevel;
  status: AlertStatus;
  created_at: string;
  case?: {
    case_number: string;
    district: string;
    victim?: { full_name: string };
  };
}

export default function OfficialAlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");

  async function loadAlerts(accessToken: string) {
    const data = await apiFetch<AlertRow[]>("/alerts", { token: accessToken });
    setAlerts(data);
  }

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).single();
      setName(prof?.full_name ?? "");
      await loadAlerts(session.access_token);
    }
    init();
  }, []);

  async function updateStatus(id: string, status: AlertStatus) {
    if (!token) return;
    await apiFetch(`/alerts/${id}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status }),
    });
    await loadAlerts(token);
  }

  return (
    <AppShell role="official" userName={name}>
      <h1 className="mb-6 text-2xl font-semibold">Alert queue</h1>

      {alerts.length === 0 ? (
        <p className="text-muted-foreground">No alerts</p>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.case?.case_number}</span>
                    <RiskBadge level={a.severity} />
                    <span className="rounded bg-secondary px-2 py-0.5 text-xs capitalize">{a.status}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {a.case?.victim?.full_name} · {a.case?.district} · {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {a.status === "open" && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus(a.id, "acknowledged")}>
                      Acknowledge
                    </Button>
                  )}
                  {a.status !== "resolved" && (
                    <Button size="sm" onClick={() => updateStatus(a.id, "resolved")}>
                      Resolve
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
