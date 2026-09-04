"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/utils";
import { homeForRole, resolveUserRole } from "@/lib/auth";
import type { Profile, CaseWithDetails, UserRole } from "@samvedna/shared-types";

type AdminStats = {
  total_users: number;
  victims: number;
  counsellors: number;
  officials: number;
  admins: number;
  cases: number;
  unassigned_cases: number;
  open_alerts: number;
};

const emptyStats: AdminStats = {
  total_users: 0,
  victims: 0,
  counsellors: 0,
  officials: 0,
  admins: 0,
  cases: 0,
  unassigned_cases: 0,
  open_alerts: 0,
};

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<Profile[]>([]);
  const [cases, setCases] = useState<CaseWithDetails[]>([]);
  const [stats, setStats] = useState<AdminStats>(emptyStats);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    phone_number: "",
    preferred_language: "en",
  });

  const reload = useCallback(async (accessToken: string) => {
    const [usersData, casesData, statsData] = await Promise.all([
      apiFetch<Profile[]>("/admin/users", { token: accessToken }),
      apiFetch<CaseWithDetails[]>("/cases", { token: accessToken }),
      apiFetch<AdminStats>("/admin/stats", { token: accessToken }),
    ]);
    setUsers(usersData);
    setCases(casesData);
    setStats(statsData);
  }, []);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", session.user.id)
        .single();

      const userRole = resolveUserRole(session.user, prof);
      setRole(userRole);
      setName(prof?.full_name ?? "");

      if (userRole !== "admin") {
        router.replace(homeForRole(userRole));
        return;
      }

      setToken(session.access_token);
      try {
        await reload(session.access_token);
      } catch {
        /* empty until API ready */
      }
    }
    load();
  }, [router, reload]);

  async function assignCase(caseId: string, counsellorId: string) {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch(`/admin/cases/${caseId}/assign`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ assigned_counsellor_id: counsellorId }),
      });
      await reload(token);
      setMessage("Counsellor assigned.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function addCounsellor(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch<Profile>("/admin/users", {
        method: "POST",
        token,
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          full_name: form.full_name.trim(),
          role: "counsellor",
          preferred_language: form.preferred_language,
          phone_number: form.phone_number
            ? form.phone_number.replace(/\D/g, "").length === 10
              ? `+91${form.phone_number.replace(/\D/g, "")}`
              : form.phone_number
            : null,
        }),
      });
      setForm({
        full_name: "",
        email: "",
        password: "",
        phone_number: "",
        preferred_language: "en",
      });
      await reload(token);
      setMessage("Counsellor account created.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create counsellor");
    } finally {
      setBusy(false);
    }
  }

  const counsellors = users.filter((u) => u.role === "counsellor");
  const victims = users.filter((u) => u.role === "victim");

  if (role !== "admin") {
    return null;
  }

  const statCards = [
    { label: "Victims", value: stats.victims },
    { label: "Counsellors", value: stats.counsellors },
    { label: "Officials", value: stats.officials },
    { label: "Cases", value: stats.cases },
    { label: "Unassigned cases", value: stats.unassigned_cases },
    { label: "Open alerts", value: stats.open_alerts },
  ];

  return (
    <AppShell userName={name} role="admin">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">System Administration</h1>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Admin only
        </span>
      </div>

      {message && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5">
              <p className="text-3xl font-semibold tabular-nums">{s.value}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add counsellor</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addCounsellor} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Full name</Label>
                <Input
                  id="c-name"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-email">Email</Label>
                <Input
                  id="c-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-pass">Temporary password</Label>
                <Input
                  id="c-pass"
                  type="password"
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-phone">Phone (10 digits, optional)</Label>
                <Input
                  id="c-phone"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.phone_number}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      phone_number: e.target.value.replace(/\D/g, "").slice(0, 10),
                    })
                  }
                  placeholder="9876543210"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-lang">Language</Label>
                <select
                  id="c-lang"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.preferred_language}
                  onChange={(e) =>
                    setForm({ ...form, preferred_language: e.target.value })
                  }
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="ta">Tamil</option>
                </select>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Saving…" : "Create counsellor"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Case assignment ({stats.unassigned_cases} unassigned)
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[28rem] space-y-3 overflow-y-auto">
            {cases.length === 0 && (
              <p className="text-sm text-muted-foreground">No cases yet.</p>
            )}
            {cases.map((c) => {
              const victim = c.victim as { full_name?: string } | undefined;
              const counsellor = c.assigned_counsellor as
                | { full_name?: string }
                | undefined;
              return (
                <div key={c.id} className="rounded border p-3 text-sm">
                  <p className="font-medium">
                    {c.case_number} — {victim?.full_name ?? "Victim"}
                  </p>
                  <p className="text-muted-foreground">
                    Counsellor: {counsellor?.full_name ?? "Unassigned"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {counsellors.map((cou) => (
                      <Button
                        key={cou.id}
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => assignCase(c.id, cou.id)}
                      >
                        → {cou.full_name.split(" ").pop()}
                      </Button>
                    ))}
                    {counsellors.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        Add a counsellor first
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Victims ({victims.length})</CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            <UserTable users={victims} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Counsellors ({counsellors.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            <UserTable users={counsellors} />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Simulated NHAA / portal intake</CardTitle>
            <p className="text-xs text-muted-foreground">
              Architected connector demo — not a live NHAA 14566 government API. Creates victim +
              case and optional first check-in through the same scoring pipeline.
            </p>
          </CardHeader>
          <CardContent>
            <NhaaIntakeForm
              token={token}
              counsellors={counsellors}
              busy={busy}
              setBusy={setBusy}
              setMessage={setMessage}
              onDone={() => reload(token)}
            />
            <p className="mt-4 text-sm">
              <a href="/official/dashboard" className="text-primary underline">
                Open national / district intelligence dashboard →
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function NhaaIntakeForm({
  token,
  counsellors,
  busy,
  setBusy,
  setMessage,
  onDone,
}: {
  token: string;
  counsellors: Profile[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMessage: (v: string) => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    complaint_id: `CMP${Date.now().toString().slice(-6)}`,
    full_name: "",
    case_type: "caste_based_violence",
    district: "Demo District",
    state: "Demo State",
    initial_message:
      "I am scared. They threatened me again before the hearing. I cannot sleep.",
    assign_counsellor_id: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch("/intake/nhaa", {
        method: "POST",
        token,
        body: JSON.stringify({
          ...f,
          assign_counsellor_id: f.assign_counsellor_id || undefined,
          channel: "chat",
          status: "investigation",
        }),
      });
      setMessage("NHAA-sim intake created — case scored through the monitoring pipeline.");
      onDone();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Intake failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Complaint ID</Label>
        <Input
          value={f.complaint_id}
          onChange={(e) => setF({ ...f, complaint_id: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label>Victim name</Label>
        <Input
          value={f.full_name}
          onChange={(e) => setF({ ...f, full_name: e.target.value })}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label>Priority case type</Label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={f.case_type}
          onChange={(e) => setF({ ...f, case_type: e.target.value })}
        >
          <option value="rape">Rape</option>
          <option value="gang_rape">Gang rape</option>
          <option value="murder">Murder</option>
          <option value="grievous_hurt">Grievous hurt</option>
          <option value="arson">Arson</option>
          <option value="witness_intimidation">Witness intimidation</option>
          <option value="caste_based_violence">Caste-based violence</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Assign counsellor</Label>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={f.assign_counsellor_id}
          onChange={(e) => setF({ ...f, assign_counsellor_id: e.target.value })}
        >
          <option value="">Unassigned</option>
          {counsellors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label>Initial distress message</Label>
        <Input
          value={f.initial_message}
          onChange={(e) => setF({ ...f, initial_message: e.target.value })}
        />
      </div>
      <Button type="submit" disabled={busy} className="md:col-span-2">
        {busy ? "Ingesting…" : "Run simulated intake"}
      </Button>
    </form>
  );
}

function UserTable({ users }: { users: Profile[] }) {
  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">None yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="pb-2">Name</th>
          <th className="pb-2">Language</th>
          <th className="pb-2">Phone</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id} className="border-b">
            <td className="py-2">{u.full_name}</td>
            <td className="py-2">{u.preferred_language}</td>
            <td className="py-2">{u.phone_number ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
