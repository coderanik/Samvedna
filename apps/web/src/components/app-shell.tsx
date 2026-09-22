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
  official: [],
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
  flush,
}: {
  role?: UserRole;
  children: React.ReactNode;
  userName?: string;
  /** Fill the screen under the header so a chat column can pin its composer. */
  flush?: boolean;
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
  const useSidebar = role === "admin" || role === "counsellor";
  const showAlertToasts = role === "admin" && Boolean(userId);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  // Victim shell — top bar (logo + sign out) + left sidebar for page nav
  if (!useSidebar) {
    return (
      <div
        className={cn(
          "flex min-h-screen flex-col bg-[var(--sanctuary-canvas,#fdfbf7)]",
          flush && "h-dvh overflow-hidden"
        )}
      >
        <header className="sticky top-0 z-50 shrink-0 border-b border-[var(--sanctuary-sand,#e8dcc8)] bg-[var(--sanctuary-canvas,#fdfbf7)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--sanctuary-canvas,#fdfbf7)]/80">
          <div className="flex h-14 items-center justify-between gap-3 px-3 sm:px-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--sanctuary-sand,#e8dcc8)] text-[var(--sanctuary-ink-2,#5a6b69)] transition hover:border-[var(--sanctuary-teal,#0f6f65)]/40 hover:bg-[var(--sanctuary-teal,#0f6f65)]/5 hover:text-[var(--sanctuary-teal,#0f6f65)] lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <Link
                href={links[0]?.href ?? "/victim/dashboard"}
                className="group flex items-center gap-2.5 no-underline"
              >
                <SamvednaMark
                  size={28}
                  className="shrink-0 transition-transform duration-300 group-hover:scale-105"
                />
                <span className="font-display text-lg font-semibold tracking-tight text-[var(--sanctuary-ink,#14211f)]">
                  Samvedna
                </span>
              </Link>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              aria-label="Sign out"
              className="h-9 gap-1.5 rounded-full px-3 text-[var(--sanctuary-ink-2,#5a6b69)] transition hover:bg-[var(--sanctuary-teal,#0f6f65)]/10 hover:text-[var(--sanctuary-teal,#0f6f65)]"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {mobileOpen && (
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 bg-[var(--sanctuary-ink,#14211f)]/25 backdrop-blur-[2px] lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}

          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col border-r border-[var(--sanctuary-sand,#e8dcc8)] bg-[var(--sanctuary-canvas,#fdfbf7)] pt-14 shadow-sm transition-transform duration-300 ease-out lg:static lg:z-0 lg:translate-x-0 lg:pt-0 lg:shadow-none",
              mobileOpen ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <div className="flex items-center justify-between border-b border-[var(--sanctuary-sand,#e8dcc8)] px-4 py-3 lg:hidden">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--sanctuary-ink-3,#93a19f)]">
                Navigate
              </p>
              <button
                type="button"
                className="rounded-md p-1.5 text-[var(--sanctuary-ink-2,#5a6b69)] transition hover:bg-[var(--sanctuary-sand,#e8dcc8)]/50 hover:text-[var(--sanctuary-ink,#14211f)]"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Primary">
              {links.map((l) => {
                const Icon = l.icon;
                const active = isActive(pathname, hash, l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm no-underline transition-all duration-200",
                      active
                        ? "bg-[var(--sanctuary-teal,#0f6f65)]/10 font-medium text-[var(--sanctuary-teal,#0f6f65)] shadow-[inset_3px_0_0_0_var(--sanctuary-teal,#0f6f65)]"
                        : "text-[var(--sanctuary-ink-2,#5a6b69)] hover:translate-x-0.5 hover:bg-[var(--sanctuary-sand,#e8dcc8)]/45 hover:text-[var(--sanctuary-ink,#14211f)]"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                        active
                          ? "bg-[var(--sanctuary-teal,#0f6f65)]/15 text-[var(--sanctuary-teal,#0f6f65)]"
                          : "bg-[var(--sanctuary-sand,#e8dcc8)]/40 text-[var(--sanctuary-ink-3,#93a19f)] group-hover:bg-[var(--sanctuary-teal,#0f6f65)]/10 group-hover:text-[var(--sanctuary-teal,#0f6f65)]"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="truncate">{l.label}</span>
                  </Link>
                );
              })}
            </nav>

            {userName && (
              <div className="border-t border-[var(--sanctuary-sand,#e8dcc8)] px-4 py-3">
                <p className="truncate text-sm font-medium text-[var(--sanctuary-ink,#14211f)]">
                  {userName}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--sanctuary-ink-3,#93a19f)]">Your space</p>
              </div>
            )}
          </aside>

          <main
            className={cn(
              "min-w-0 flex-1 overflow-x-hidden",
              flush
                ? "flex min-h-0 flex-col overflow-hidden"
                : "px-4 py-5 sm:px-6 sm:py-6 lg:px-8"
            )}
          >
            {children}
          </main>
        </div>
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
