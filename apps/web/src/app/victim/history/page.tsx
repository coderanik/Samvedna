"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { MeshGradient } from "@/components/mesh-gradient";
import { CrisisSheet } from "@/components/crisis-sheet";
import type { Checkin, Profile } from "@samvedna/shared-types";

/** Care journey — NEVER shows scores or risk labels. */
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
    <main className="theme-sanctuary relative min-h-screen">
      <MeshGradient />
      <div className="relative mx-auto max-w-2xl px-6 py-10">
        <header className="mb-12 flex items-center justify-between">
          <div>
            <p className="text-[11px] tracking-[0.3em] text-[var(--sanctuary-ink-3)]">SAMVEDNA</p>
            <h1 className="font-display text-3xl text-[var(--sanctuary-ink)]">Your care journey</h1>
            <p className="mt-2 text-[var(--sanctuary-ink-2)]">
              What you shared, and that someone is walking with you — never a score.
            </p>
          </div>
          <CrisisSheet />
        </header>

        <div className="relative border-l border-[var(--sanctuary-sand)] pl-8">
          {checkins.length === 0 && (
            <p className="text-[var(--sanctuary-ink-2)]">
              No check-ins yet.{" "}
              <Link href="/victim/checkin" className="text-[var(--sanctuary-teal)] underline">
                Begin when you are ready →
              </Link>
            </p>
          )}
          {checkins.map((c) => (
            <article key={c.id} className="relative mb-10">
              <span className="absolute -left-[2.4rem] top-1 h-3 w-3 rounded-full bg-[var(--sanctuary-teal)]" />
              <p className="text-xs text-[var(--sanctuary-ink-3)]">
                {new Date(c.created_at).toLocaleString()} · {c.channel.replace(/_/g, " ")}
              </p>
              <p className="mt-2 font-display text-lg italic text-[var(--sanctuary-ink)]">
                {c.raw_transcript.slice(0, 220)}
                {c.raw_transcript.length > 220 ? "…" : ""}
              </p>
              <p className="mt-2 text-sm text-[var(--sanctuary-ink-2)]">
                Received. Your care team can see this when they need to.
              </p>
            </article>
          ))}
        </div>

        <Link
          href="/victim/checkin"
          className="mt-8 inline-block text-sm text-[var(--sanctuary-teal)] underline underline-offset-4"
        >
          ← Back to check-in
        </Link>
        {profile && (
          <p className="mt-12 text-xs text-[var(--sanctuary-ink-3)]">{profile.full_name}</p>
        )}
      </div>
    </main>
  );
}
