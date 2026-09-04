"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { CrisisNotice } from "@/components/crisis-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Checkin, Profile } from "@samvedna/shared-types";

/** Care timeline for survivors — NEVER shows scores or risk labels. */
export default function VictimHistoryPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checkins, setCheckins] = useState<Checkin[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(prof);

      const { data } = await supabase
        .from("checkins")
        .select("id, case_id, victim_id, channel, raw_transcript, created_at")
        .eq("victim_id", user.id)
        .order("created_at", { ascending: false });

      setCheckins((data as Checkin[]) ?? []);
    }
    load();
  }, []);

  return (
    <AppShell role="victim" userName={profile?.full_name}>
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your care journey</h1>
        <p className="text-sm text-muted-foreground">
          Moments you shared, and care taken on your behalf — without scores or labels.
        </p>
        <CrisisNotice locale={profile?.preferred_language} />

        {checkins.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            No check-ins yet. When you talk with Mann-Mitra, your journey appears here.
          </p>
        ) : (
          <div className="space-y-3">
            {checkins.map((c) => (
              <Card key={c.id} className="border-teal-900/10 bg-white/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-medium">
                    {new Date(c.created_at).toLocaleDateString(undefined, {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </CardTitle>
                  <p className="text-xs capitalize text-muted-foreground">via {c.channel}</p>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-3 text-sm text-muted-foreground">{c.raw_transcript}</p>
                  <p className="mt-3 text-xs text-teal-900/70">
                    Thank you for sharing. Your care team looks after what comes next.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
