"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Briefcase,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Phone,
  Shield,
  Sparkles,
  User,
  Users,
  UserRound,
  X,
} from "lucide-react";
import type { UserRole } from "@samvedna/shared-types";
import { resolveUserRole } from "@/lib/auth";
import { SamvednaMark } from "@/components/samvedna-logo";
import { AlertToast } from "@/components/alert-toast";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
};

const NAV: Record<UserRole, NavItem[]> = {
  victim: [
    { href: "/victim/dashboard", label: "Home", icon: LayoutDashboard },
    { href: "/victim/chatbot", label: "Chatbot", icon: MessageCircle },
    { href: "/victim/consultant", label: "Consultant", icon: UserRound },
    { href: "/victim/exercises", label: "Exercises", icon: Sparkles },
    { href: "/victim/profile", label: "Profile", icon: User },
  ],
  counsellor: [
    { href: "/counselor/cases", label: "Cases", icon: LayoutDashboard },
    { href: "/counselor/calls", label: "Calls", icon: Phone },
  ],
  official: [
    { href: "/admin#overview", label: "Overview", icon: Shield, group: "Operations" },
    { href: "/admin#cases", label: "Cases", icon: FolderOpen, group: "Operations" },
    { href: "/admin#alerts", label: "Alerts", icon: AlertTriangle, group: "Operations" },
  ],
  admin: [
    { href: "/admin#overview", label: "Overview", icon: Shield, group: "Admin" },
    { href: "/admin#victims", label: "Victims", icon: Users, group: "Directory" },
    { href: "/admin#counsellors", label: "Counsellors", icon: Briefcase, group: "Directory" },
    { href: "/admin#cases", label: "Cases", icon: FolderOpen, group: "Directory" },
    { href: "/admin#alerts", label: "Alerts", icon: AlertTriangle, group: "Intelligence" },
  ],
};

function parseHref(href: string) {
  const [path, hash] = href.split("#");
  return { path: path || "/", hash: hash ?? "" };
}

function isActive(pathname: string, hash: string, href: string) {
  const target = parseHref(href);
  const onAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (target.path === "/admin") {
    if (!onAdmin) return false;
    const current = hash || "overview";
    return current === (target.hash || "overview");
  }

  return pathname === target.path || pathname.startsWith(`${target.path}/`);
}

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hash, setHash] = useState("");
  const [userId, setUserId] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;
      setUserId(session.user.id);
      setToken(session.access_token);
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();
      if (error) {
        console.warn("[AppShell] profiles select failed:", error.message);
      }
      setRole(resolveUserRole(session.user, profile));
    }
    loadRole();
  }, [roleProp]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const sync = () => setHash(window.location.hash.replace(/^#/, ""));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  const links = NAV[role] ?? NAV.victim;
  const useSidebar = role === "admin" || role === "counsellor" || role === "official";
  const showAlertToasts =
    (role === "admin" || role === "official") && Boolean(userId);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (!useSidebar) {
    // Victim (and similar) shell — top bar + bottom tabs on mobile
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:px-4">
            <Link
              href={links[0]?.href ?? "/"}
              className="group flex min-w-0 items-center gap-2 font-semibold text-primary sm:gap-2.5"
            >
              <SamvednaMark size={26} className="shrink-0 transition-transform group-hover:scale-105" />
              <span className="font-display text-base font-semibold tracking-tight text-foreground sm:text-lg">
                Samvedna
              </span>
            </Link>

            {/* Desktop / tablet horizontal nav */}
            <nav className="hidden items-center gap-0.5 md:flex">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm transition-colors lg:px-3",
                    isActive(pathname, hash, l.href)
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              {userName && (
                <span className="hidden max-w-[140px] truncate text-sm text-muted-foreground lg:inline">
                  {userName}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                aria-label="Sign out"
                className="h-9 w-9 p-0 sm:h-9 sm:w-auto sm:px-3"
              >
                <LogOut className="h-4 w-4" />
                <span className="ml-1.5 hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4 sm:py-6 md:px-6">
          {children}
        </main>

        {/* Mobile bottom tab bar */}
        <nav
          className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
          aria-label="Primary"
        >
          <ul className="mx-auto grid max-w-lg grid-cols-5">
            {links.map((l) => {
              const Icon = l.icon;
              const active = isActive(pathname, hash, l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className={cn(
                      "flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors",
                      active ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    <Icon className={cn("h-5 w-5", active && "stroke-[2.25px]")} />
                    <span className="truncate">{l.label === "Exercises" ? "Plans" : l.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    );
  }

  const groups = links.reduce<Record<string, NavItem[]>>((acc, item) => {
    const key = item.group ?? "Navigate";
    (acc[key] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="flex min-h-screen bg-[hsl(40_33%_98%)]">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-border bg-card shadow-sm transition-transform duration-200 lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
            <SamvednaMark size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display font-semibold tracking-tight text-foreground">
              Samvedna
            </p>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
              {role === "admin" ? "Admin" : role}
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group}
              </p>
              <div className="space-y-0.5">
                {items.map((l) => {
                  const Icon = l.icon;
                  const active = isActive(pathname, hash, l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={(e) => {
                        const { path, hash: h } = parseHref(l.href);
                        const onSameAdminPage =
                          path === "/admin" &&
                          (pathname === "/admin" || pathname.startsWith("/admin/"));
                        if (onSameAdminPage) {
                          e.preventDefault();
                          const next = h || "overview";
                          const url = `/admin#${next}`;
                          window.history.pushState(null, "", url);
                          setHash(next);
                          window.dispatchEvent(new HashChangeEvent("hashchange"));
                          setMobileOpen(false);
                          return;
                        }
                        setHash(h);
                        setMobileOpen(false);
                      }}
                      className={cn(
                        "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active ? "text-primary" : "text-muted-foreground/70"
                        )}
                      />
                      <span>{l.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-4">
          <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <p className="truncate text-sm font-medium text-foreground">
              {userName || "Signed in"}
            </p>
            <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">{role}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            className="rounded-md border border-border bg-card p-2 text-muted-foreground"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <SamvednaMark size={22} />
            <span className="font-display text-sm font-semibold">Samvedna</span>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      {showAlertToasts && <AlertToast userId={userId} token={token} role={role} />}
    </div>
  );
}
