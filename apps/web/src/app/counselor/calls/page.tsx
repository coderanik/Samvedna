"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/utils/supabase/client";
import { CounsellorShell } from "@/components/counsellor-shell";
import { IncomingCallPanel } from "@/components/incoming-call-panel";
import { Button } from "@/components/ui/button";
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      setUserId(session.user.id);
      connectSocket(session.user.id);

      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();
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
    <CounsellorShell
      userName={name}
      userId={userId}
      token={token}
      actions={
        userId && token ? (
          <IncomingCallPanel userId={userId} token={token} onRefresh={() => loadCalls(token)} />
        ) : null
      }
    >
      <div className="px-4 py-6 sm:px-6">
        <header className="mb-6 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sanctuary-ink-3)]">
            Counsellor
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--sanctuary-ink)] sm:text-3xl">
            Calls
          </h1>
          <p className="max-w-xl text-sm text-[var(--sanctuary-ink-2)]">
            High/critical survivors are routed to you. Accept, speak, then mark complete.
          </p>
        </header>

        {calls.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--sanctuary-sand)] bg-[var(--sanctuary-sand)]/20 px-6 py-14 text-center">
            <Phone className="mx-auto mb-3 h-10 w-10 text-[var(--sanctuary-ink-3)] opacity-60" />
            <p className="font-display text-lg text-[var(--sanctuary-ink)]">No pending calls</p>
            <p className="mt-2 text-sm text-[var(--sanctuary-ink-2)]">
              When a survivor needs a live counsellor, the request will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {calls.map((c) => {
              const victim = c.victim as
                | { full_name?: string; phone_number?: string | null }
                | undefined;
              const caseNum = c.case as { case_number?: string } | undefined;
              return (
                <div
                  key={c.id}
                  className="rounded-lg border border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-medium text-[var(--sanctuary-ink)]">
                      {victim?.full_name ?? "Survivor"} · {caseNum?.case_number}
                    </h2>
                    <span className="rounded-full bg-[var(--sanctuary-terracotta)]/15 px-2 py-0.5 text-xs capitalize text-[var(--sanctuary-terracotta)]">
                      {c.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--sanctuary-ink-2)]">
                    Risk at request:{" "}
                    <strong className="capitalize">{c.risk_level_at_call}</strong>
                    {c.distress_score_at_call != null && ` (score ${c.distress_score_at_call})`}
                  </p>
                  {victim?.phone_number && (
                    <a
                      href={`tel:${victim.phone_number.replace(/\s/g, "")}`}
                      className="mt-2 inline-flex items-center gap-2 text-[var(--sanctuary-teal)] underline"
                    >
                      <Phone className="h-4 w-4" />
                      Call: {victim.phone_number}
                    </a>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
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
                            prompt("Brief call notes (saved as check-in):") ??
                              "Counsellor voice call completed"
                          )
                        }
                      >
                        Mark call complete
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CounsellorShell>
  );
}
