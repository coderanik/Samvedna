"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Heart, LogOut } from "lucide-react";
import type { UserRole } from "@samvedna/shared-types";
import { resolveUserRole } from "@/lib/auth";

const NAV: Record<UserRole, { href: string; label: string }[]> = {
  victim: [
    { href: "/victim/checkin", label: "Check-in" },
    { href: "/victim/call", label: "Call" },
    { href: "/victim/history", label: "History" },
  ],
  counsellor: [
    { href: "/counsellor/cases", label: "Cases" },
    { href: "/counsellor/calls", label: "Calls" },
  ],
  official: [
    { href: "/official/dashboard", label: "Dashboard" },
    { href: "/official/alerts", label: "Alerts" },
  ],
  admin: [
    { href: "/admin", label: "Administration" },
    { href: "/official/dashboard", label: "District view" },
    { href: "/official/alerts", label: "Alerts" },
  ],
};

export function AppShell({
  role: roleProp,
  children,
  userName,
}: {
  role?: UserRole;
  children: React.ReactNode;
  userName?: string;
}) {
  const pathname = usePathname();
  const [role, setRole] = useState<UserRole>(roleProp ?? "victim");

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setRole(resolveUserRole(user, profile));
    }
    loadRole();
  }, [roleProp]);

  const links = NAV[role] ?? NAV.victim;

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href={links[0]?.href ?? "/"} className="flex items-center gap-2 font-semibold text-primary">
            <Heart className="h-5 w-5 fill-primary/20" />
            Samvedna
            {role === "admin" && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                Admin
              </span>
            )}
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  pathname.startsWith(l.href)
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {userName && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {userName}
                <span className="ml-1 capitalize text-xs opacity-60">({role})</span>
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
