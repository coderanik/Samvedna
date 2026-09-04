"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/client";
import { apiFetch } from "@/lib/utils";

type Exercise = {
  id: string;
  tag: string;
  title: string;
  description: string;
  steps: string[] | unknown;
  content_url: string | null;
  duration_minutes: number | null;
};

type Payload = {
  tags: Array<{ tag: string }>;
  recommendations: Exercise[];
  logic: string;
};

export default function VictimExercisesPage() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [active, setActive] = useState<Exercise | null>(null);
  const [error, setError] = useState("");

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
        const d = await apiFetch<Payload>("/victim/exercises", { token: session.access_token });
        setData(d);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load exercises");
      }
    }
    init();
  }, []);

  function stepsOf(ex: Exercise): string[] {
    if (Array.isArray(ex.steps)) return ex.steps as string[];
    return [];
  }

  return (
    <AppShell role="victim" userName={name}>
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-xl font-semibold sm:text-2xl">Exercises & Wellness Plans</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Matched from themes in your private chats — simple, explainable recommendations.
          </p>
        </header>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {(data?.tags?.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-2">
            {data!.tags.map((t) => (
              <span
                key={t.tag}
                className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {t.tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Chat a little first so we can match plans to what you&apos;re carrying. General steadiness
            plans are shown until then.
          </p>
        )}

        {active ? (
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-xl">{active.title}</CardTitle>
              <CardDescription>
                {active.tag} · {active.duration_minutes ?? 10} min
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">{active.description}</p>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {stepsOf(active).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {active.content_url && (
                <a
                  href={active.content_url}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open resource
                </a>
              )}
              <Button variant="outline" onClick={() => setActive(null)}>
                Back to plans
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {(data?.recommendations ?? []).map((ex) => (
              <Card key={ex.id}>
                <CardHeader>
                  <CardTitle className="text-base">{ex.title}</CardTitle>
                  <CardDescription>
                    {ex.tag} · {ex.duration_minutes ?? 10} min
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{ex.description}</p>
                  <Button size="sm" onClick={() => setActive(ex)}>
                    Start / View plan
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {data?.logic && (
          <p className="text-xs text-muted-foreground">Matching: {data.logic}</p>
        )}
        {!token && null}
      </div>
    </AppShell>
  );
}
