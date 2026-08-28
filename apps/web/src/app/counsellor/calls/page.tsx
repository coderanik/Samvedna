"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { AlertToast } from "@/components/alert-toast";
import { IncomingCallPanel } from "@/components/incoming-call-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import { connectSocket } from "@/lib/socket";
import { Phone } from "lucide-react";
import type { CallSession } from "@samvedna/shared-types";

interface PendingCall extends CallSession {
  case?: { case_number: string };
  victim?: { full_name: string; phone_number: string | null };
}

export default function CounsellorCallsPage() {
  const [calls, setCalls] = useState<PendingCall[]>([]);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");

  const loadCalls = useCallback(async (accessToken: string) => {
    const data = await apiFetch<PendingCall[]>("/calls/pending", { token: accessToken });
    setCalls(data);
  }, []);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      setUserId(session.user.id);
      connectSocket(session.user.id);

      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).single();
      setName(prof?.full_name ?? "");

      await loadCalls(session.access_token);
    }
    init();
  }, [loadCalls]);

  async function acceptCall(id: string) {
    await apiFetch(`/calls/${id}/status`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status: "in_progress" }),
    });
    await loadCalls(token);
  }

  async function exotelBridge(id: string) {
    try {
      await apiFetch(`/calls/${id}/bridge`, { method: "POST", token });
      await loadCalls(token);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Exotel bridge failed");
    }
  }

  async function completeCall(id: string, transcript: string) {
    await apiFetch(`/calls/${id}/complete`, {
      method: "POST",
      token,
      body: JSON.stringify({ transcript, duration_seconds: 0 }),
    });
    await loadCalls(token);
  }

  return (
    <AppShell role="counsellor" userName={name}>
      {userId && <AlertToast userId={userId} />}
      {userId && token && (
        <IncomingCallPanel userId={userId} token={token} onRefresh={() => loadCalls(token)} />
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Counsellor calls</h1>
        <Link href="/counsellor/cases">
          <Button variant="outline" size="sm">← Cases</Button>
        </Link>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        High/critical victims are routed to you. Accept the call, speak with them, then mark complete.
      </p>

      {calls.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Phone className="mx-auto mb-3 h-10 w-10 opacity-30" />
            No pending counsellor calls
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {calls.map((c) => {
            const victim = c.victim as { full_name?: string; phone_number?: string | null } | undefined;
            const caseNum = c.case as { case_number?: string } | undefined;
            return (
              <Card key={c.id} className="border-risk-high/30">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{victim?.full_name ?? "Victim"} · {caseNum?.case_number}</span>
                    <span className="rounded-full bg-risk-high/10 px-2 py-0.5 text-xs capitalize text-risk-high">
                      {c.status.replace("_", " ")}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Risk at request: <strong className="capitalize">{c.risk_level_at_call}</strong>
                    {c.distress_score_at_call != null && ` (score ${c.distress_score_at_call})`}
                  </p>
                  {victim?.phone_number && (
                    <a
                      href={`tel:${victim.phone_number.replace(/\s/g, "")}`}
                      className="inline-flex items-center gap-2 text-primary underline"
                    >
                      <Phone className="h-4 w-4" />
                      Call victim: {victim.phone_number}
                    </a>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {c.status === "requested" && (
                      <>
                        <Button onClick={() => acceptCall(c.id)}>Accept call</Button>
                        <Button variant="outline" onClick={() => exotelBridge(c.id)}>
                          Dial via Exotel
                        </Button>
                      </>
                    )}
                    {c.status === "in_progress" && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          completeCall(
                            c.id,
                            prompt("Brief call notes (saved as check-in):") ?? "Counsellor voice call completed"
                          )
                        }
                      >
                        Mark call complete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
