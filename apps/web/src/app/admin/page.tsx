"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { OpsIntelligence } from "@/components/ops-intelligence";
import { RiskBadge } from "@/components/risk-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/utils";
import { homeForRole, resolveUserRole } from "@/lib/auth";
import type { Profile, CaseWithDetails, UserRole, AlertStatus, RiskLevel } from "@samvedna/shared-types";
import {
  AlertTriangle,
  Briefcase,
  FolderOpen,
  Plus,
  Shield,
  UserPlus,
  Users,
  X,
} from "lucide-react";

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

type ControlSection = "overview" | "victims" | "counsellors" | "cases" | "alerts";

type AlertRow = {
  id: string;
  case_id: string;
  severity: RiskLevel;
  status: AlertStatus;
  created_at: string;
  case?: {
    case_number: string;
    district: string;
    victim?: { full_name: string };
  };
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

const emptyUserForm = {
  full_name: "",
  email: "",
  password: "",
  phone_number: "",
  preferred_language: "en",
};

function readSection(): ControlSection {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace(/^#/, "");
  if (
    hash === "victims" ||
    hash === "counsellors" ||
    hash === "cases" ||
    hash === "alerts"
  ) {
    return hash;
  }
  return "overview";
}

function subscribeSection(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function useControlSection(): ControlSection {
  return useSyncExternalStore(subscribeSection, readSection, () => "overview");
}

function Overlay({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close overlay"
        className="absolute inset-0 bg-foreground/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[81] max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ControlPlanePage() {
  const router = useRouter();
  const section = useControlSection();
  const [users, setUsers] = useState<Profile[]>([]);
  const [cases, setCases] = useState<CaseWithDetails[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [stats, setStats] = useState<AdminStats>(emptyStats);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [caseForm, setCaseForm] = useState({
    complaint_id: "",
    full_name: "",
    case_type: "caste_based_violence",
    district: "Demo District",
    state: "Demo State",
    initial_message:
      "I am scared. They threatened me again before the hearing. I cannot sleep.",
    assign_counsellor_id: "",
  });

  const isAdmin = role === "admin";

  const reload = useCallback(
    async (accessToken: string, userRole: UserRole) => {
      const casesData = await apiFetch<CaseWithDetails[]>("/cases", { token: accessToken });
      const alertsData = await apiFetch<AlertRow[]>("/alerts", { token: accessToken });
      setCases(casesData);
      setAlerts(alertsData);

      if (userRole === "admin") {
        const [usersData, statsData] = await Promise.all([
          apiFetch<Profile[]>("/admin/users", { token: accessToken }),
          apiFetch<AdminStats>("/admin/stats", { token: accessToken }),
        ]);
        setUsers(usersData);
        setStats(statsData);
      } else {
        // Officials: derive a light directory from assigned cases when possible
        setUsers([]);
        setStats({
          ...emptyStats,
          cases: casesData.length,
          unassigned_cases: casesData.filter((c) => !c.assigned_counsellor_id).length,
          open_alerts: alertsData.filter(
            (a) => a.status === "open" || a.status === "acknowledged"
          ).length,
        });
      }
    },
    []
  );

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

      if (userRole !== "admin" && userRole !== "official") {
        router.replace(homeForRole(userRole));
        return;
      }

      setToken(session.access_token);
      try {
        await reload(session.access_token, userRole);
      } catch {
        /* empty until API ready */
      }
    }
    load();
  }, [router, reload]);

  useEffect(() => {
    setMessage("");
    setOverlayOpen(false);
    setUserForm(emptyUserForm);
    setCaseForm((f) => ({
      ...f,
      complaint_id: `CMP${Date.now().toString().slice(-6)}`,
      full_name: "",
      assign_counsellor_id: "",
    }));
  }, [section]);

  async function assignCase(caseId: string, counsellorId: string) {
    if (!token || !isAdmin) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch(`/admin/cases/${caseId}/assign`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ assigned_counsellor_id: counsellorId }),
      });
      await reload(token, "admin");
      setMessage("Counsellor assigned.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function createUser(createRole: "counsellor" | "victim") {
    if (!token || !isAdmin) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch<Profile>("/admin/users", {
        method: "POST",
        token,
        body: JSON.stringify({
          email: userForm.email.trim().toLowerCase(),
          password: userForm.password,
          full_name: userForm.full_name.trim(),
          role: createRole,
          preferred_language: userForm.preferred_language,
          phone_number: userForm.phone_number
            ? userForm.phone_number.replace(/\D/g, "").length === 10
              ? `+91${userForm.phone_number.replace(/\D/g, "")}`
              : userForm.phone_number
            : null,
        }),
      });
      setUserForm(emptyUserForm);
      setOverlayOpen(false);
      await reload(token, "admin");
      setMessage(
        createRole === "counsellor" ? "Counsellor account created." : "Victim account created."
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }

  async function createCase(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !isAdmin) return;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch("/intake/nhaa", {
        method: "POST",
        token,
        body: JSON.stringify({
          ...caseForm,
          assign_counsellor_id: caseForm.assign_counsellor_id || undefined,
          channel: "portal",
          status: "investigation",
        }),
      });
      setOverlayOpen(false);
      setCaseForm({
        complaint_id: `CMP${Date.now().toString().slice(-6)}`,
        full_name: "",
        case_type: "caste_based_violence",
        district: "Demo District",
        state: "Demo State",
        initial_message:
          "I am scared. They threatened me again before the hearing. I cannot sleep.",
        assign_counsellor_id: "",
      });
      await reload(token, "admin");
      setMessage("Case created through simulated intake.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create case");
    } finally {
      setBusy(false);
    }
  }

  async function updateAlertStatus(id: string, status: AlertStatus) {
    if (!token) return;
    setBusy(true);
    try {
      await apiFetch(`/alerts/${id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status }),
      });
      if (role) await reload(token, role);
      setMessage(`Alert marked ${status}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update alert");
    } finally {
      setBusy(false);
    }
  }

  const counsellors = users.filter((u) => u.role === "counsellor");
  const victims = users.filter((u) => u.role === "victim");

  if (role !== "admin" && role !== "official") {
    return null;
  }

  const titles: Record<
    ControlSection,
    { eyebrow: string; title: string; blurb: string; addLabel?: string }
  > = {
    overview: {
      eyebrow: "Control plane",
      title: isAdmin ? "Administration & intelligence" : "District intelligence",
      blurb: isAdmin
        ? "Provisioning, caseload, and population intelligence in one place."
        : "District operations overview — alerts, risk, and justice-stage funnel.",
    },
    victims: {
      eyebrow: "Directory",
      title: "Victims",
      blurb: "Survivor accounts registered in the system.",
      addLabel: isAdmin ? "Add victim" : undefined,
    },
    counsellors: {
      eyebrow: "Directory",
      title: "Counsellors",
      blurb: "Provision counsellor logins and review the current roster.",
      addLabel: isAdmin ? "Add counsellor" : undefined,
    },
    cases: {
      eyebrow: "Caseload",
      title: "Cases",
      blurb: isAdmin
        ? "Assign or reassign counsellors to open cases."
        : "Cases in your district scope.",
      addLabel: isAdmin ? "Add case" : undefined,
    },
    alerts: {
      eyebrow: "Intelligence",
      title: "Distress alerts",
      blurb: "Acknowledge and resolve high-risk distress alerts.",
    },
  };

  const header = titles[section];

  const adminStatCards = [
    { label: "Victims", value: stats.victims, icon: Users, href: "/admin#victims" },
    { label: "Counsellors", value: stats.counsellors, icon: Briefcase, href: "/admin#counsellors" },
    { label: "Officials", value: stats.officials, icon: Shield },
    { label: "Cases", value: stats.cases, icon: FolderOpen, href: "/admin#cases" },
    { label: "Unassigned", value: stats.unassigned_cases, icon: UserPlus, href: "/admin#cases" },
    { label: "Open alerts", value: stats.open_alerts, icon: AlertTriangle, href: "/admin#alerts" },
  ];

  function goSection(hash: string) {
    window.history.pushState(null, "", `/admin#${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  return (
    <AppShell userName={name} role={role}>
      <div className="mx-auto max-w-[1200px] space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              {header.eyebrow}
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight text-foreground sm:text-4xl">
              {header.title}
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">{header.blurb}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {header.addLabel && (
              <Button type="button" onClick={() => setOverlayOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                {header.addLabel}
              </Button>
            )}
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium capitalize text-primary">
              {role}
            </span>
          </div>
        </div>

        {message && (
          <p className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
            {message}
          </p>
        )}

        {section === "overview" && (
          <div className="space-y-8">
            {isAdmin && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {adminStatCards.map((s) => {
                  const Icon = s.icon;
                  const inner = (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <Icon className="h-4 w-4 text-primary/70" />
                      </div>
                      <p className="text-4xl font-semibold tabular-nums text-foreground">
                        {s.value}
                      </p>
                      <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {s.label}
                      </p>
                    </>
                  );
                  return (
                    <Card key={s.label} className="shadow-none transition hover:border-primary/30">
                      <CardContent className="pt-6">
                        {s.href ? (
                          <button
                            type="button"
                            className="block w-full text-left outline-none"
                            onClick={() => goSection(s.href!.split("#")[1] || "overview")}
                          >
                            {inner}
                          </button>
                        ) : (
                          inner
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
            {token && <OpsIntelligence token={token} role={role} />}
          </div>
        )}

        {section === "counsellors" && isAdmin && (
          <Card className="shadow-none">
            <CardContent className="pt-6">
              <UserTable users={counsellors} empty="No counsellors yet. Use Add counsellor." />
            </CardContent>
          </Card>
        )}

        {section === "victims" && isAdmin && (
          <Card className="shadow-none">
            <CardContent className="pt-6">
              <UserTable users={victims} empty="No victims yet. Use Add victim." />
            </CardContent>
          </Card>
        )}

        {(section === "counsellors" || section === "victims") && !isAdmin && (
          <p className="text-sm text-muted-foreground">
            Directory provisioning is available to system admins only.
          </p>
        )}

        {section === "cases" && (
          <Card className="shadow-none">
            <CardContent className="grid gap-3 pt-6 md:grid-cols-2">
              {cases.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No cases yet{isAdmin ? ". Use Add case." : "."}
                </p>
              )}
              {cases.map((c) => {
                const victim = c.victim as { full_name?: string } | undefined;
                const counsellor = c.assigned_counsellor as
                  | { full_name?: string }
                  | undefined;
                return (
                  <div
                    key={c.id}
                    className="rounded-lg border border-border bg-muted/20 p-4 text-sm"
                  >
                    <p className="font-medium text-foreground">
                      {c.case_number} — {victim?.full_name ?? "Victim"}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Counsellor: {counsellor?.full_name ?? "Unassigned"}
                    </p>
                    {isAdmin && (
                      <div className="mt-3 flex flex-wrap gap-1">
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
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {section === "alerts" && (
          <div className="space-y-3">
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No alerts</p>
            ) : (
              alerts.map((a) => (
                <Card key={a.id} className="shadow-none">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{a.case?.case_number}</span>
                        <RiskBadge level={a.severity} />
                        <span className="rounded bg-secondary px-2 py-0.5 text-xs capitalize">
                          {a.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {a.case?.victim?.full_name} · {a.case?.district} ·{" "}
                        {new Date(a.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {a.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => updateAlertStatus(a.id, "acknowledged")}
                        >
                          Acknowledge
                        </Button>
                      )}
                      {a.status !== "resolved" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => updateAlertStatus(a.id, "resolved")}
                        >
                          Resolve
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>

      {isAdmin && (section === "counsellors" || section === "victims") && (
        <Overlay
          open={overlayOpen}
          onClose={() => setOverlayOpen(false)}
          title={section === "counsellors" ? "Add counsellor" : "Add victim"}
          description={
            section === "counsellors"
              ? "Creates a login and profile with the counsellor role."
              : "Creates a survivor login and profile."
          }
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createUser(section === "counsellors" ? "counsellor" : "victim");
            }}
          >
            <Field label="Full name">
              <Input
                value={userForm.full_name}
                onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                required
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                required
              />
            </Field>
            <Field label="Temporary password">
              <Input
                type="password"
                minLength={8}
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                required
              />
            </Field>
            <Field label="Phone (10 digits, optional)">
              <Input
                inputMode="numeric"
                maxLength={10}
                value={userForm.phone_number}
                onChange={(e) =>
                  setUserForm({
                    ...userForm,
                    phone_number: e.target.value.replace(/\D/g, "").slice(0, 10),
                  })
                }
                placeholder="9876543210"
              />
            </Field>
            <Field label="Language">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={userForm.preferred_language}
                onChange={(e) =>
                  setUserForm({ ...userForm, preferred_language: e.target.value })
                }
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="ta">Tamil</option>
              </select>
            </Field>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setOverlayOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={busy}>
                {busy
                  ? "Saving…"
                  : section === "counsellors"
                    ? "Create counsellor"
                    : "Create victim"}
              </Button>
            </div>
          </form>
        </Overlay>
      )}

      {isAdmin && section === "cases" && (
        <Overlay
          open={overlayOpen}
          onClose={() => setOverlayOpen(false)}
          title="Add case"
          description="Simulated NHAA / portal intake — creates victim + case through the scoring pipeline."
        >
          <form onSubmit={createCase} className="space-y-3">
            <Field label="Complaint ID">
              <Input
                value={caseForm.complaint_id}
                onChange={(e) => setCaseForm({ ...caseForm, complaint_id: e.target.value })}
                required
              />
            </Field>
            <Field label="Victim name">
              <Input
                value={caseForm.full_name}
                onChange={(e) => setCaseForm({ ...caseForm, full_name: e.target.value })}
                required
              />
            </Field>
            <Field label="Case type">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={caseForm.case_type}
                onChange={(e) => setCaseForm({ ...caseForm, case_type: e.target.value })}
              >
                <option value="rape">Rape</option>
                <option value="gang_rape">Gang rape</option>
                <option value="murder">Murder</option>
                <option value="grievous_hurt">Grievous hurt</option>
                <option value="arson">Arson</option>
                <option value="witness_intimidation">Witness intimidation</option>
                <option value="caste_based_violence">Caste-based violence</option>
              </select>
            </Field>
            <Field label="Assign counsellor">
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={caseForm.assign_counsellor_id}
                onChange={(e) =>
                  setCaseForm({ ...caseForm, assign_counsellor_id: e.target.value })
                }
              >
                <option value="">Unassigned</option>
                {counsellors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Initial distress message">
              <Input
                value={caseForm.initial_message}
                onChange={(e) =>
                  setCaseForm({ ...caseForm, initial_message: e.target.value })
                }
              />
            </Field>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setOverlayOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={busy}>
                {busy ? "Creating…" : "Create case"}
              </Button>
            </div>
          </form>
        </Overlay>
      )}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function UserTable({ users, empty }: { users: Profile[]; empty: string }) {
  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="pb-2 font-medium">Name</th>
          <th className="pb-2 font-medium">Language</th>
          <th className="pb-2 font-medium">Phone</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id} className="border-b border-border/70">
            <td className="py-2.5">{u.full_name}</td>
            <td className="py-2.5 text-muted-foreground">{u.preferred_language}</td>
            <td className="py-2.5 text-muted-foreground">{u.phone_number ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
