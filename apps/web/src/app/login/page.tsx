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
import { SamvednaMark } from "@/components/samvedna-logo";

const PORTAL = process.env.NEXT_PUBLIC_PORTAL ?? "";
const IS_ADMIN_PORTAL = PORTAL === "admin";
const SHOW_ADMIN_HINT = process.env.NEXT_PUBLIC_SHOW_ADMIN_HINT === "1";
const ADMIN_EMAIL_HINT = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "admin@samvedna.demo";
/** Dev-only hint — never ship a password string in client bundles for production. */
const ADMIN_PASSWORD_HINT =
  process.env.NODE_ENV === "development" && SHOW_ADMIN_HINT
    ? process.env.NEXT_PUBLIC_ADMIN_PASSWORD_HINT ?? ""
    : "";

const DEMO_ACCOUNTS =
  process.env.NODE_ENV === "development"
    ? ([
        { label: "Victim", email: "victim1@samvedna.demo", password: "Samvedna@2024" },
        { label: "Counsellor", email: "counsellor1@samvedna.demo", password: "Samvedna@2024" },
        { label: "Official", email: "official@samvedna.demo", password: "Samvedna@2024" },
        { label: "Admin", email: "admin@samvedna.demo", password: "SamvednaAdmin@2024" },
      ] as const)
    : [];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(IS_ADMIN_PORTAL ? ADMIN_EMAIL_HINT : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (IS_ADMIN_PORTAL) {
      setEmail(ADMIN_EMAIL_HINT);
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
          <div className="mx-auto mb-3 flex items-center justify-center">
            <SamvednaMark size={54} animated />
          </div>
          <CardTitle className="font-display text-2xl tracking-wide">{IS_ADMIN_PORTAL ? "Samvedna Admin" : "Samvedna"}</CardTitle>
          <CardDescription className="text-xs">
            {IS_ADMIN_PORTAL
              ? "System administration portal"
              : "संवेदना · listening beyond words · शब्दों से परे"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {IS_ADMIN_PORTAL && SHOW_ADMIN_HINT && (
            <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Fixed admin login (dev hint)</p>
              <p>
                Email: <span className="font-mono text-foreground">{ADMIN_EMAIL_HINT}</span>
              </p>
              {ADMIN_PASSWORD_HINT ? (
                <p>
                  Password:{" "}
                  <span className="font-mono text-foreground">{ADMIN_PASSWORD_HINT}</span>
                </p>
              ) : (
                <p>Password is in your ops notes / ensure-admin script — not embedded here.</p>
              )}
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

          {!IS_ADMIN_PORTAL && DEMO_ACCOUNTS.length > 0 && (
            <div className="mt-4 rounded-md border border-dashed border-border bg-muted/40 px-3 py-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Demo accounts
              </p>
              <div className="flex flex-wrap gap-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground transition hover:border-primary/40 hover:bg-primary/5"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                      setError("");
                    }}
                  >
                    {account.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Fills the form — then click Sign in. Password for most roles:{" "}
                <span className="font-mono">Samvedna@2024</span>
              </p>
            </div>
          )}

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
