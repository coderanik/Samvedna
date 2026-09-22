"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { SamvednaMark } from "@/components/samvedna-logo";
import { AlertToast } from "@/components/alert-toast";
import { NewAssignmentToast } from "@/components/new-assignment-toast";
import { cn } from "@/lib/utils";

/**
 * Shared sanctuary chrome for counsellor queue, patient home, and calls.
 */
export function CounsellorShell({
  children,
  userName,
  userId,
  token,
  actions,
}: {
  children: React.ReactNode;
  userName?: string;
  userId?: string;
  token?: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const links = [
    { href: "/counselor/cases", label: "Cases" },
    { href: "/counselor/calls", label: "Calls" },
  ];

  return (
    <div className="theme-sanctuary min-h-screen">
      <header className="sticky top-0 z-50 border-b border-[var(--sanctuary-sand)] bg-[var(--sanctuary-canvas)]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/counselor/cases" className="group flex items-center gap-2.5">
              <SamvednaMark size={26} className="shrink-0 transition-transform group-hover:scale-105" />
              <span className="font-display text-lg font-semibold tracking-tight text-[var(--sanctuary-ink)]">
                Samvedna
              </span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {links.map((l) => {
                const active =
                  pathname === l.href || pathname.startsWith(`${l.href}/`);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-[var(--sanctuary-teal)]/10 font-medium text-[var(--sanctuary-teal)]"
                        : "text-[var(--sanctuary-ink-2)] hover:text-[var(--sanctuary-ink)]"
                    )}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {actions}
            {userName && (
              <span className="hidden max-w-[140px] truncate text-sm text-[var(--sanctuary-ink-2)] md:inline">
                {userName}
              </span>
            )}
            <button
              type="button"
              onClick={logout}
              className="text-xs text-[var(--sanctuary-ink-2)] underline-offset-4 hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="flex gap-1 border-t border-[var(--sanctuary-sand)] px-4 py-2 sm:hidden">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-center text-sm",
                  active
                    ? "bg-[var(--sanctuary-teal)]/10 font-medium text-[var(--sanctuary-teal)]"
                    : "text-[var(--sanctuary-ink-2)]"
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {userId && <AlertToast userId={userId} token={token} role="counsellor" />}
      {userId && <NewAssignmentToast userId={userId} />}

      <div className="mx-auto max-w-[1400px]">{children}</div>
    </div>
  );
}
