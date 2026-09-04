"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/utils/supabase/client";
import { apiFetch } from "@/lib/utils";

type ProfilePayload = {
  profile: {
    id: string;
    full_name: string;
    preferred_language: string;
    phone_number: string | null;
    case_reference: string | null;
    bio: string | null;
    instant_call_count: number;
    consultant_meet_count: number;
    created_at: string;
  };
  cases: Array<{
    id: string;
    case_number: string;
    case_type: string;
    status: string;
    district: string;
    state: string;
  }>;
  score_history: Array<{
    id: string;
    score: number;
    source: string | null;
    created_at: string;
  }>;
  meet_reports: Array<{
    id: string;
    status: string;
    scheduled_at: string;
    report: string | null;
    recommendations: string | null;
    consultant: { name: string; specialization: string } | Array<{ name: string }> | null;
  }>;
  instant_call_history: Array<{
    id: string;
    summary: string | null;
    created_at: string;
    duration_seconds: number | null;
    status: string;
  }>;
  tags: Array<{ tag: string }>;
};

export default function VictimProfilePage() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    phone_number: "",
    preferred_language: "en",
    case_reference: "",
    bio: "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      try {
        const d = await apiFetch<ProfilePayload>("/victim/profile", {
          token: session.access_token,
        });
        setData(d);
        setForm({
          full_name: d.profile.full_name ?? "",
          phone_number: d.profile.phone_number ?? "",
          preferred_language: d.profile.preferred_language ?? "en",
          case_reference: d.profile.case_reference ?? "",
          bio: d.profile.bio ?? "",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load profile");
      }
    }
    init();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const updated = await apiFetch<ProfilePayload["profile"]>("/victim/profile", {
        method: "PATCH",
        token,
        body: JSON.stringify({
          full_name: form.full_name,
          phone_number: form.phone_number || null,
          preferred_language: form.preferred_language,
          case_reference: form.case_reference || null,
          bio: form.bio || null,
        }),
      });
      setData((prev) => (prev ? { ...prev, profile: { ...prev.profile, ...updated } } : prev));
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function consultantName(m: ProfilePayload["meet_reports"][0]) {
    const c = m.consultant;
    if (!c) return "Consultant";
    if (Array.isArray(c)) return c[0]?.name ?? "Consultant";
    return c.name;
  }

  return (
    <AppShell role="victim" userName={form.full_name}>
      <div className="mx-auto max-w-3xl space-y-6 sm:space-y-8">
        <header>
          <h1 className="font-display text-xl font-semibold sm:text-2xl">Profile</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Your details, meet reports, pulse history, and call log — private to you.
          </p>
        </header>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {message && <p className="text-sm text-primary">{message}</p>}

        <Card>
          <CardHeader>
            <CardTitle>Your information</CardTitle>
            <CardDescription>Editable fields update your Samvedna profile.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input
                  id="full_name"
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone_number}
                  onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lang">Language</Label>
                <Input
                  id="lang"
                  value={form.preferred_language}
                  onChange={(e) => setForm((f) => ({ ...f, preferred_language: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="case_ref">Case reference</Label>
                <Input
                  id="case_ref"
                  value={form.case_reference}
                  onChange={(e) => setForm((f) => ({ ...f, case_reference: e.target.value }))}
                  placeholder="e.g. FIR / portal reference"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="bio">Note to self</Label>
                <Input
                  id="bio"
                  value={form.bio}
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Case metadata</h2>
          {(data?.cases ?? []).map((c) => (
            <Card key={c.id}>
              <CardContent className="py-4 text-sm">
                <p className="font-medium">{c.case_number}</p>
                <p className="text-muted-foreground">
                  {c.case_type} · {c.status.replace(/_/g, " ")} · {c.district}, {c.state}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Consultant meet reports</h2>
          {(data?.meet_reports ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No reports yet.</p>
          )}
          {(data?.meet_reports ?? []).map((m) => (
            <Card key={m.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{consultantName(m)}</CardTitle>
                <CardDescription>
                  {new Date(m.scheduled_at).toLocaleString("en-IN")} · {m.status}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {m.report ? <p>{m.report}</p> : <p className="text-muted-foreground">No report yet.</p>}
                {m.recommendations && (
                  <p>
                    <span className="text-xs font-medium text-muted-foreground">Recommendations · </span>
                    {m.recommendations}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Wellbeing pulse history</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {(data?.score_history ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="tabular-nums">{s.score}</span>
                <span className="text-xs text-muted-foreground">
                  {s.source ?? "—"} · {new Date(s.created_at).toLocaleString("en-IN")}
                </span>
              </li>
            ))}
            {(data?.score_history ?? []).length === 0 && (
              <li className="px-4 py-3 text-sm text-muted-foreground">No scores yet.</li>
            )}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Instant call history</h2>
          <ul className="space-y-2">
            {(data?.instant_call_history ?? []).map((c) => (
              <li key={c.id} className="rounded-lg border bg-card px-3 py-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleString("en-IN")}
                  {c.duration_seconds ? ` · ${c.duration_seconds}s` : ""} · {c.status}
                </p>
                <p>{c.summary ?? "No summary captured."}</p>
              </li>
            ))}
            {(data?.instant_call_history ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">No instant calls yet.</li>
            )}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
