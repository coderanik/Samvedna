import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { homeForRole, isDeprecatedRole, resolveUserRole } from "@/lib/auth";
import { LandingNarrative } from "@/components/landing-narrative";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = resolveUserRole(user, profile);
    // Official portal removed — do not redirect (avoids / ↔ / loops); middleware clears session.
    if (!isDeprecatedRole(role)) {
      redirect(homeForRole(role));
    }
  }

  return <LandingNarrative />;
}
