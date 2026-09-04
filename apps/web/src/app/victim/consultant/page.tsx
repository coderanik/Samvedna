"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/client";
import { apiFetch } from "@/lib/utils";
import { Calendar, UserRound } from "lucide-react";

type Consultant = {
  id: string;
  name: string;
  photo_url: string | null;
  specialization: string;
  bio: string | null;
  availability_note?: string | null;
  active_case_count?: number;
};

type ConsultantPayload = {
  allotted: { assignment_id: string; assigned_at: string; consultant: Consultant } | null;
  pending_message: string | null;
  directory: Consultant[];
  meets: Array<{
    id: string;
    status: string;
    scheduled_at: string;
    report: string | null;
    recommendations: string | null;
  }>;
  updates: Array<{ id: string; event_type: string; message: string; created_at: string }>;
  browse_note: string;
};

type Slot = { id: string; starts_at: string; ends_at: string };

export default function VictimConsultantPage() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [data, setData] = useState<ConsultantPayload | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState(false);

  async function refresh(accessToken: string) {
    const d = await apiFetch<ConsultantPayload>("/victim/consultant", { token: accessToken });
    setData(d);
    if (d.allotted) {
      try {
        const s = await apiFetch<Slot[]>("/victim/consultant/slots", { token: accessToken });
        setSlots(s);
      } catch {
        setSlots([]);
      }
    }
  }

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();
      setName(prof?.full_name ?? "");
      try {
        await refresh(session.access_token);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load consultant");
      }
    }
    init();
  }, []);

  async function book(slotId: string) {
    if (!token) return;
    setBooking(true);
    setError("");
    try {
      await apiFetch("/victim/consultant/book", {
        method: "POST",
        token,
        body: JSON.stringify({ slot_id: slotId }),
      });
      await refresh(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setBooking(false);
    }
  }

  async function bookCustom() {
    if (!token) return;
    const when = window.prompt("Pick a date/time (ISO or leave blank for tomorrow 11:00 IST)");
    let scheduled_at: string;
    if (when?.trim()) {
      scheduled_at = new Date(when).toISOString();
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(11, 0, 0, 0);
      scheduled_at = d.toISOString();
    }
    setBooking(true);
    try {
      await apiFetch("/victim/consultant/book", {
        method: "POST",
        token,
        body: JSON.stringify({ scheduled_at }),
      });
      await refresh(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setBooking(false);
    }
  }

  const allotted = data?.allotted?.consultant;

  return (
    <AppShell role="victim" userName={name}>
      <div className="space-y-6 sm:space-y-8">
        <header>
          <h1 className="font-display text-xl font-semibold sm:text-2xl">Consultant</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Your allotted counsellor appears after your first check-in score.
          </p>
        </header>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {!allotted ? (
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-xl">Pending allotment</CardTitle>
              <CardDescription>
                {data?.pending_message ??
                  "Your consultant will be assigned once your first check-in is complete."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/victim/chatbot">Start a check-in chat</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-primary/20">
            <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-start">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                {allotted.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={allotted.photo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserRound className="h-8 w-8 text-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="font-display text-lg sm:text-xl">{allotted.name}</CardTitle>
                <CardDescription>{allotted.specialization}</CardDescription>
                <p className="mt-2 text-sm text-muted-foreground">{allotted.bio}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {allotted.availability_note ?? "Weekdays 10:00–18:00 IST"}
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button onClick={bookCustom} disabled={booking}>
                  <Calendar className="mr-2 h-4 w-4" />
                  Book a session
                </Button>
              </div>
              {slots.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Open slots</p>
                  <div className="flex flex-wrap gap-2">
                    {slots.map((s) => (
                      <Button
                        key={s.id}
                        size="sm"
                        variant="outline"
                        disabled={booking}
                        onClick={() => book(s.id)}
                      >
                        {new Date(s.starts_at).toLocaleString("en-IN", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Browse consultants</h2>
          <p className="text-xs text-muted-foreground">{data?.browse_note}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.directory ?? []).map((c) => (
              <Card key={c.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription>{c.specialization}</CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {c.bio ?? "Trauma-informed support for atrocity survivors."}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Updates</h2>
          <ul className="space-y-2">
            {(data?.updates ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">No updates yet.</li>
            )}
            {(data?.updates ?? []).map((u) => (
              <li key={u.id} className="rounded-lg border bg-card px-3 py-2 text-sm">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {u.event_type.replace(/_/g, " ")}
                </span>
                <p>{u.message}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(u.created_at).toLocaleString("en-IN")}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Meet reports</h2>
          <div className="space-y-3">
            {(data?.meets ?? []).map((m) => (
              <Card key={m.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base capitalize">{m.status}</CardTitle>
                  <CardDescription>
                    {new Date(m.scheduled_at).toLocaleString("en-IN")}
                  </CardDescription>
                </CardHeader>
                {(m.report || m.recommendations) && (
                  <CardContent className="space-y-2 text-sm">
                    {m.report && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Report</p>
                        <p>{m.report}</p>
                      </div>
                    )}
                    {m.recommendations && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Recommendations</p>
                        <p>{m.recommendations}</p>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
            {(data?.meets ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No meetings yet.</p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
