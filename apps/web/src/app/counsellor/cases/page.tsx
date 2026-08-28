"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { AlertToast } from "@/components/alert-toast";
import { IncomingCallPanel } from "@/components/incoming-call-panel";
import { RiskBadge } from "@/components/risk-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import type { CaseWithDetails } from "@samvedna/shared-types";
import { ChevronRight } from "lucide-react";

export default function CounsellorCasesPage() {
  const [cases, setCases] = useState<CaseWithDetails[]>([]);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);
      setToken(session.access_token);

      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).single();
      setName(prof?.full_name ?? "");

      const data = await apiFetch<CaseWithDetails[]>("/cases", { token: session.access_token });
      setCases(data);
    }
    load();
  }, []);

  return (
    <AppShell role="counsellor" userName={name}>
      {userId && <AlertToast userId={userId} />}
      {userId && token && (
        <IncomingCallPanel userId={userId} token={token} onRefresh={() => {}} />
      )}
      <h1 className="mb-6 text-2xl font-semibold">Assigned cases</h1>

      {cases.length === 0 ? (
        <p className="text-muted-foreground">No cases assigned yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cases.map((c) => {
            const victim = c.victim as { full_name?: string } | undefined;
            return (
              <Link key={c.id} href={`/counsellor/cases/${c.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div>
                      <CardTitle className="text-lg">{c.case_number}</CardTitle>
                      <p className="text-sm text-muted-foreground">{victim?.full_name}</p>
                    </div>
                    {c.latest_score ? (
                      <RiskBadge level={c.latest_score.risk_level} score={c.latest_score.score} />
                    ) : (
                      <RiskBadge level="low" />
                    )}
                  </CardHeader>
                  <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{c.case_type} · {c.district}</span>
                    <ChevronRight className="h-4 w-4" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
