import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { homeForRole, resolveUserRole } from "@/lib/auth";

/** Combined control plane for system admins and district officials. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = resolveUserRole(user, profile);
  if (role !== "admin" && role !== "official") {
    redirect(homeForRole(role));
  }

  return <>{children}</>;
}
