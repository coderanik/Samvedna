import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { homeForRole, isDeprecatedRole, resolveUserRole } from "@/lib/auth";
import type { UserRole } from "@samvedna/shared-types";
import { DEMO_COOKIE, isDemoFallback, parseDemoCookie } from "@/lib/demo-fallback";

const PUBLIC_PATHS = ["/login", "/signup", "/onboard", "/auth", "/brand"];
const AUTH_PATHS = ["/login", "/signup"];

function demoUpdateSession(request: NextRequest) {
  const session = parseDemoCookie(request.cookies.get(DEMO_COOKIE)?.value);
  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isAuthPage = AUTH_PATHS.some((p) => pathname === p);
  const user = session
    ? {
        id: session.id,
        user_metadata: { role: session.role, onboarding_completed: true },
      }
    : null;

  if (!user && !isPublic && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const role = session ? resolveUserRole(user as never, { role: session.role }) : null;

  if (user && isAuthPage && role && !isDeprecatedRole(role)) {
    const url = request.nextUrl.clone();
    url.pathname = homeForRole(role);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/" && role && !isDeprecatedRole(role)) {
    const url = request.nextUrl.clone();
    url.pathname = homeForRole(role);
    return NextResponse.redirect(url);
  }

  if (user && pathname !== "/" && !isPublic && role) {
    if (pathname.startsWith("/victim") && role !== "victim") {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    if (
      (pathname.startsWith("/counselor") || pathname.startsWith("/counsellor")) &&
      role !== "counsellor" &&
      role !== "admin"
    ) {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    if (
      pathname.startsWith("/official") &&
      role !== "official" &&
      role !== "admin" &&
      role !== "counsellor"
    ) {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    if (pathname.startsWith("/admin") && role !== "admin") {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
  }

  return NextResponse.next({ request });
}

export async function updateSession(request: NextRequest) {
  if (isDemoFallback()) return demoUpdateSession(request);

  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isAuthPage = AUTH_PATHS.some((p) => pathname === p);

  if (!user && !isPublic && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  let role: UserRole | null = null;
  let victimNeedsOnboarding = false;

  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, onboarding_completed_at")
      .eq("id", user.id)
      .maybeSingle();
    // RLS recursion can 500 on profiles — fall back to JWT metadata so routes still work
    if (profileError) {
      console.warn("[middleware] profiles select failed:", profileError.message);
    }
    role = resolveUserRole(user, profile);

    const metaDone = user.user_metadata?.onboarding_completed === true;
    const metaRequired = user.user_metadata?.onboarding_required === true;
    const columnMissing = Boolean(
      profileError?.message?.includes("onboarding_completed_at")
    );
    if (role === "victim" && !metaDone) {
      if (columnMissing) {
        // Migration not applied — only gate users flagged at signup
        victimNeedsOnboarding = metaRequired;
      } else if (
        profile &&
        Object.prototype.hasOwnProperty.call(profile, "onboarding_completed_at")
      ) {
        victimNeedsOnboarding = !profile.onboarding_completed_at;
      } else if (!profileError && metaRequired) {
        victimNeedsOnboarding = true;
      }
    }

    const onVictimOnboarding = pathname.startsWith("/victim/onboarding");
    if (victimNeedsOnboarding && pathname.startsWith("/victim") && !onVictimOnboarding) {
      const url = request.nextUrl.clone();
      url.pathname = "/victim/onboarding";
      return NextResponse.redirect(url);
    }
  }

  // Deprecated official sessions used to map home → /login and loop forever.
  // Clear the session once, then allow /login (or landing) to render.
  if (user && isDeprecatedRole(role)) {
    await supabase.auth.signOut();
    if (isAuthPage || pathname === "/") {
      return supabaseResponse;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("reason", "official-retired");
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirect.cookies.set(c.name, c.value);
    });
    return redirect;
  }

  if (user && isAuthPage && role && !isDeprecatedRole(role)) {
    const url = request.nextUrl.clone();
    url.pathname = victimNeedsOnboarding ? "/victim/onboarding" : homeForRole(role);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/" && role && !isDeprecatedRole(role)) {
    const url = request.nextUrl.clone();
    url.pathname = victimNeedsOnboarding ? "/victim/onboarding" : homeForRole(role);
    return NextResponse.redirect(url);
  }

  if (user && pathname !== "/" && !isPublic && role) {
    if (pathname.startsWith("/victim") && role !== "victim") {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    if (
      (pathname.startsWith("/counselor") || pathname.startsWith("/counsellor")) &&
      role !== "counsellor" &&
      role !== "admin"
    ) {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    if (
      pathname.startsWith("/official") &&
      role !== "official" &&
      role !== "admin" &&
      role !== "counsellor"
    ) {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    if (pathname.startsWith("/admin") && role !== "admin") {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
  }

  return supabaseResponse;
}
