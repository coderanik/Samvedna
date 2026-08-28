import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { homeForRole, resolveUserRole } from "@/lib/auth";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  redirect(homeForRole(resolveUserRole(user, profile)));
}
