"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";
import { homeForRole, resolveUserRole } from "@/lib/auth";
import type { Profile, CaseWithDetails, UserRole } from "@samvedna/shared-types";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<Profile[]>([]);
  const [cases, setCases] = useState<CaseWithDetails[]>([]);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
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
        const [usersData, casesData] = await Promise.all([
          apiFetch<Profile[]>("/admin/users", { token: session.access_token }),
          apiFetch<CaseWithDetails[]>("/cases", { token: session.access_token }),
        ]);
        setUsers(usersData);
        setCases(casesData);
      } catch {
        /* API errors shown via empty state */
      }
    }
    load();
  }, [router]);

  async function assignCase(caseId: string, counsellorId: string) {
    if (!token) return;
    await apiFetch(`/admin/cases/${caseId}/assign`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ assigned_counsellor_id: counsellorId }),
    });
  }

  const counsellors = users.filter((u) => u.role === "counsellor");

  if (role !== "admin") {
    return null;
  }

  return (
    <AppShell userName={name}>
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">System Administration</h1>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Admin only
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Users ({users.length})</CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2">Language</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b">
                    <td className="py-2">{u.full_name}</td>
                    <td className="py-2 capitalize">{u.role}</td>
                    <td className="py-2">{u.preferred_language}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Case assignment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cases.map((c) => {
              const victim = c.victim as { full_name?: string } | undefined;
              const counsellor = c.assigned_counsellor as { full_name?: string } | undefined;
              return (
                <div key={c.id} className="rounded border p-3 text-sm">
                  <p className="font-medium">{c.case_number} — {victim?.full_name}</p>
                  <p className="text-muted-foreground">Counsellor: {counsellor?.full_name ?? "Unassigned"}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {counsellors.map((cou) => (
                      <Button
                        key={cou.id}
                        size="sm"
                        variant="outline"
                        onClick={() => assignCase(c.id, cou.id)}
                      >
                        → {cou.full_name.split(" ").pop()}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
