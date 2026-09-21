"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { apiFetch } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SamvednaMark } from "@/components/samvedna-logo";

type IntakeResult = {
  case: { id: string; case_number: string; case_type: string };
  playbook: { id: string; label: string };
  invite: { url: string; email_status: string; expires_at: string };
  honesty: string;
};

const CASE_TYPES = [
  { value: "rape", label: "Rape" },
  { value: "gang_rape", label: "Gang rape" },
  { value: "murder", label: "Murder" },
  { value: "grievous_hurt", label: "Grievous hurt" },
  { value: "arson", label: "Arson" },
  { value: "witness_intimidation", label: "Witness intimidation / threats" },
  { value: "caste_based_violence", label: "Caste-based violence" },
  { value: "family_violence", label: "Family affected by caste violence" },
  { value: "atrocity", label: "Other atrocity" },
] as const;

export default function OfficialIntakePage() {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [form, setForm] = useState({
    victim_full_name: "",
    victim_email: "",
    victim_phone: "",
    preferred_language: "en",
    case_number: "",
    judiciary_ref: "",
    case_type: "caste_based_violence",
    district: "",
    state: "",
    intake_brief: "",
    district_notify_email: "",
    official_notify_email: "",
  });

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }
      setToken(session.access_token);
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", session.user.id)
        .single();
      setName(prof?.full_name ?? "");
      if (prof?.role && !["admin", "official", "counsellor"].includes(prof.role)) {
        window.location.href = "/";
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const data = await apiFetch<IntakeResult>("/judiciary/intake", {
        method: "POST",
        token,
        body: JSON.stringify({
          ...form,
          case_number: form.case_number || undefined,
          victim_phone: form.victim_phone || undefined,
          intake_brief: form.intake_brief || undefined,
          district_notify_email: form.district_notify_email || undefined,
          official_notify_email: form.official_notify_email || undefined,
          judiciary_ref: form.judiciary_ref || undefined,
        }),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Intake failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-background to-emerald-50/40">
      <header className="border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <SamvednaMark size={28} />
            <div>
              <p className="font-display text-lg font-semibold leading-none">Samvedna</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Judiciary / NHAA desk
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{name}</span>
            <button type="button" className="underline-offset-4 hover:underline" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div>
          <h1 className="font-display text-2xl font-semibold">Register survivor for monitoring</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter minimal case details. The survivor receives a secure invite, completes light
            onboarding, and monitoring begins. Not a live government API — desk connector for demo /
            pilot.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Case desk intake</CardTitle>
            <CardDescription>
              Victim never creates a public account first — you register, they claim the invite.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Survivor full name</Label>
                <Input
                  required
                  value={form.victim_full_name}
                  onChange={(e) => setForm({ ...form, victim_full_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Survivor email</Label>
                <Input
                  type="email"
                  required
                  value={form.victim_email}
                  onChange={(e) => setForm({ ...form, victim_email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone (optional)</Label>
                <Input
                  value={form.victim_phone}
                  onChange={(e) => setForm({ ...form, victim_phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Case type (priority use case)</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.case_type}
                  onChange={(e) => setForm({ ...form, case_type: e.target.value })}
                >
                  {CASE_TYPES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Preferred language</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.preferred_language}
                  onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="ta">Tamil</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>District</Label>
                <Input
                  required
                  value={form.district}
                  onChange={(e) => setForm({ ...form, district: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input
                  required
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Case number (optional)</Label>
                <Input
                  value={form.case_number}
                  onChange={(e) => setForm({ ...form, case_number: e.target.value })}
                  placeholder="Auto-generated if blank"
                />
              </div>
              <div className="space-y-2">
                <Label>Judiciary / FIR ref (optional)</Label>
                <Input
                  value={form.judiciary_ref}
                  onChange={(e) => setForm({ ...form, judiciary_ref: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>District alert email</Label>
                <Input
                  type="email"
                  value={form.district_notify_email}
                  onChange={(e) => setForm({ ...form, district_notify_email: e.target.value })}
                  placeholder="district.nodal@example.gov.in"
                />
              </div>
              <div className="space-y-2">
                <Label>Designated official email</Label>
                <Input
                  type="email"
                  value={form.official_notify_email}
                  onChange={(e) => setForm({ ...form, official_notify_email: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Brief (no unnecessary PII)</Label>
                <textarea
                  className="min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.intake_brief}
                  onChange={(e) => setForm({ ...form, intake_brief: e.target.value })}
                  placeholder="Threats before hearing; family unsafe; sleep disruption…"
                  maxLength={2000}
                />
              </div>
              {error && (
                <p className="sm:col-span-2 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                  {busy ? "Registering…" : "Register & send invite"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {result && (
          <Card className="border-emerald-500/30">
            <CardHeader>
              <CardTitle className="text-lg">Invite sent</CardTitle>
              <CardDescription>{result.honesty}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Case:</span> {result.case.case_number} ·{" "}
                {result.case.case_type}
              </p>
              <p>
                <span className="text-muted-foreground">Playbook:</span> {result.playbook.label}
              </p>
              <p>
                <span className="text-muted-foreground">Email:</span> {result.invite.email_status}
              </p>
              <p className="break-all">
                <span className="text-muted-foreground">Invite URL:</span>{" "}
                <a className="text-primary underline" href={result.invite.url}>
                  {result.invite.url}
                </a>
              </p>
              <p className="text-xs text-muted-foreground">
                Expires {new Date(result.invite.expires_at).toLocaleString("en-IN")}
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
