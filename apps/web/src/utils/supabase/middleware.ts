import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { homeForRole, resolveUserRole } from "@/lib/auth";
import type { UserRole } from "@samvedna/shared-types";

const PUBLIC_PATHS = ["/login", "/signup", "/onboard", "/auth"];
const AUTH_PATHS = ["/login", "/signup"];

export async function updateSession(request: NextRequest) {
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

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = resolveUserRole(user, profile);
  }

  if (user && isAuthPage && role) {
    const url = request.nextUrl.clone();
    url.pathname = homeForRole(role);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/" && role) {
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
    if (pathname.startsWith("/official") && role !== "official" && role !== "admin") {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    if (pathname.startsWith("/admin") && role !== "admin") {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
  }

  return supabaseResponse;
}
