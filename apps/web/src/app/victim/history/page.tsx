"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { CrisisNotice } from "@/components/crisis-notice";
import { RiskBadge } from "@/components/risk-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Checkin, DistressScore, Profile } from "@samvedna/shared-types";

export default function VictimHistoryPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checkins, setCheckins] = useState<Array<Checkin & { distress_score?: DistressScore }>>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(prof);

      const { data } = await supabase
        .from("checkins")
        .select("*, distress_scores(*)")
        .eq("victim_id", user.id)
        .order("created_at", { ascending: false });

      const mapped = (data ?? []).map((c) => {
        const scores = c.distress_scores as unknown as DistressScore[];
        const { distress_scores: _, ...rest } = c;
        return { ...rest, distress_score: scores?.[0] };
      });
      setCheckins(mapped);
    }
    load();
  }, []);

  return (
    <AppShell role="victim" userName={profile?.full_name}>
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Your check-ins</h1>
        <CrisisNotice locale={profile?.preferred_language} />

        {checkins.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">No check-ins yet. Your conversations will appear here.</p>
        ) : (
          <div className="space-y-3">
            {checkins.map((c) => (
              <Card key={c.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-medium">
                      {new Date(c.created_at).toLocaleDateString(undefined, {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </CardTitle>
                    {c.distress_score && (
                      <RiskBadge level={c.distress_score.risk_level} score={c.distress_score.score} />
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3">{c.raw_transcript}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
