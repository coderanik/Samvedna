import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { homeForRole, isDeprecatedRole, resolveUserRole } from "@/lib/auth";

/**
 * OAuth / magic-link callback — exchanges ?code= for a session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, onboarding_completed_at")
          .eq("id", user.id)
          .single();
        const role = resolveUserRole(user, profile);
        if (isDeprecatedRole(role)) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?reason=official-retired`);
        }
        let dest = next && next.startsWith("/") ? next : homeForRole(role);
        const onboarded =
          Boolean(
            profile &&
              "onboarding_completed_at" in profile &&
              (profile as { onboarding_completed_at?: string | null }).onboarding_completed_at
          ) || user.user_metadata?.onboarding_completed === true;
        if (
          role === "victim" &&
          !onboarded &&
          (user.user_metadata?.onboarding_required === true ||
            (profile &&
              Object.prototype.hasOwnProperty.call(profile, "onboarding_completed_at") &&
              !(profile as { onboarding_completed_at?: string | null }).onboarding_completed_at))
        ) {
          dest = "/victim/onboarding";
        }
        return NextResponse.redirect(`${origin}${dest}`);
      }
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
