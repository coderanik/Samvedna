import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { homeForRole, resolveUserRole } from "@/lib/auth";

export default async function OfficialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = resolveUserRole(user, profile);
  if (role !== "official" && role !== "admin" && role !== "counsellor") {
    redirect(homeForRole(role));
  }

  return (
    <div className="min-h-screen bg-[var(--sanctuary-canvas)] text-[var(--sanctuary-ink)]">
      <header className="border-b border-[var(--sanctuary-sand)] px-6 py-4">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p className="font-display text-xl tracking-tight">Samvedna · Authority desk</p>
          <nav className="flex gap-4 text-sm text-[var(--sanctuary-ink-2)]">
            <a href="/official/dashboard" className="hover:text-[var(--sanctuary-teal)]">
              District / state
            </a>
            <a href="/official/intake" className="hover:text-[var(--sanctuary-teal)]">
              Judiciary intake
            </a>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
