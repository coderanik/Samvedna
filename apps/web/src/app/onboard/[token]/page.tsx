"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL, apiFetch } from "@/lib/utils";

type TokenInfo = {
  invite_email?: string | null;
  invite_full_name?: string | null;
  invite_language?: string | null;
  cases?: { case_number: string; case_type: string };
};

export default function OnboardPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    preferred_language: "en",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/admin/onboarding/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: TokenInfo) => {
        setTokenInfo(data);
        setForm((f) => ({
          ...f,
          email: data.invite_email ?? f.email,
          full_name: data.invite_full_name ?? f.full_name,
          preferred_language: data.invite_language ?? f.preferred_language,
        }));
      })
      .catch(() => setError("This onboarding link is invalid or has expired."));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();

    // Try sign-in first (judiciary may have pre-created the account)
    let accessToken: string | null = null;
    const signedIn = await supabase.auth.signInWithPassword({
      email: form.email.trim().toLowerCase(),
      password: form.password,
    });

    if (signedIn.data.session) {
      accessToken = signedIn.data.session.access_token;
    } else {
      const { data: signedUp, error: authError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            full_name: form.full_name,
            role: "victim",
            preferred_language: form.preferred_language,
            onboarding_required: true,
          },
        },
      });
      if (authError) {
        // Account exists but password wrong — surface clearly
        setError(authError.message);
        setLoading(false);
        return;
      }
      accessToken = signedUp.session?.access_token ?? null;
      if (!accessToken) {
        // Email confirmation required — try password sign-in anyway
        const again = await supabase.auth.signInWithPassword({
          email: form.email.trim().toLowerCase(),
          password: form.password,
        });
        accessToken = again.data.session?.access_token ?? null;
      }
    }

    if (!accessToken) {
      setError("Account created but session missing. Confirm email, then sign in.");
      setLoading(false);
      return;
    }

    try {
      await apiFetch("/judiciary/claim", {
        method: "POST",
        token: accessToken,
        body: JSON.stringify({ token }),
      });
    } catch (err) {
      // Non-fatal if already claimed — still continue to questionnaire
      console.warn(err);
    }

    router.push("/victim/onboarding");
  }

  const caseInfo = tokenInfo?.cases;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to Samvedna</CardTitle>
          <CardDescription>
            {caseInfo
              ? `You've been invited to join case ${caseInfo.case_number} (${caseInfo.case_type.replace(/_/g, " ")}). Set your password, then a short well-being check.`
              : "Complete your registration"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && !tokenInfo ? (
            <p className="text-destructive">{error}</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Full name</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Create password</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  minLength={8}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Continuing…" : "Continue to well-being check"}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm">
            <Link href="/login" className="text-primary hover:underline">
              Already registered? Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
