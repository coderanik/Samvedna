"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { homeForRole, resolveUserRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart } from "lucide-react";

const PORTAL = process.env.NEXT_PUBLIC_PORTAL ?? "";
const IS_ADMIN_PORTAL = PORTAL === "admin";
const SHOW_ADMIN_HINT = process.env.NEXT_PUBLIC_SHOW_ADMIN_HINT === "1";

const FIXED_ADMIN_EMAIL = "admin@samvedna.demo";
const FIXED_ADMIN_PASSWORD = "SamvednaAdmin@2024";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(IS_ADMIN_PORTAL ? FIXED_ADMIN_EMAIL : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (IS_ADMIN_PORTAL) {
      setEmail(FIXED_ADMIN_EMAIL);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    const user = authData.user;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = resolveUserRole(user, profile);

    if (IS_ADMIN_PORTAL && role !== "admin") {
      await supabase.auth.signOut();
      setError("This portal is for the system admin only.");
      setLoading(false);
      return;
    }

    router.refresh();
    router.push(homeForRole(role));
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError("");
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setGoogleLoading(false);
    }
  }

  async function resendConfirmation() {
    if (!email.trim()) {
      setError("Enter your email first, then resend confirmation.");
      return;
    }
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
    });
    if (resendError) setError(resendError.message);
    else setError("");
    alert(`Confirmation email sent to ${email.trim().toLowerCase()}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Heart className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{IS_ADMIN_PORTAL ? "Samvedna Admin" : "Samvedna"}</CardTitle>
          <CardDescription>
            {IS_ADMIN_PORTAL
              ? "System administration portal"
              : "Listening beyond words · शब्दों से परे"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {IS_ADMIN_PORTAL && SHOW_ADMIN_HINT && (
            <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Fixed admin login</p>
              <p>
                Email: <span className="font-mono text-foreground">{FIXED_ADMIN_EMAIL}</span>
              </p>
              <p>
                Password:{" "}
                <span className="font-mono text-foreground">{FIXED_ADMIN_PASSWORD}</span>
              </p>
            </div>
          )}
          {IS_ADMIN_PORTAL && !SHOW_ADMIN_HINT && (
            <p className="mb-4 text-center text-xs text-muted-foreground">
              System administration portal — use the fixed admin credentials from your ops notes.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                readOnly={IS_ADMIN_PORTAL}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || googleLoading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          {!IS_ADMIN_PORTAL && (
            <>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={loading || googleLoading}
                onClick={handleGoogle}
              >
                {googleLoading ? "Opening Google..." : "Continue with Google"}
              </Button>

              <button
                type="button"
                className="mt-3 w-full text-center text-xs text-muted-foreground underline"
                onClick={resendConfirmation}
              >
                Resend confirmation email
              </button>

              <p className="mt-4 text-center text-sm text-muted-foreground">
                No account?{" "}
                <Link href="/signup" className="text-primary hover:underline">
                  Create one
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
