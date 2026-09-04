import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { homeForRole, resolveUserRole } from "@/lib/auth";

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
          .select("role")
          .eq("id", user.id)
          .single();
        const role = resolveUserRole(user, profile);
        const dest = next && next.startsWith("/") ? next : homeForRole(role);
        return NextResponse.redirect(`${origin}${dest}`);
      }
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
