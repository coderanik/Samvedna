"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL } from "@/lib/utils";

export default function OnboardPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [tokenInfo, setTokenInfo] = useState<{ cases?: { case_number: string; case_type: string } } | null>(null);
  const [form, setForm] = useState({ email: "", password: "", full_name: "", preferred_language: "en" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/admin/onboarding/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setTokenInfo)
      .catch(() => setError("This onboarding link is invalid or has expired."));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    const { error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          full_name: form.full_name,
          role: "victim",
          preferred_language: form.preferred_language,
        },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push("/login");
  }

  const caseInfo = tokenInfo?.cases;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to Samvedna</CardTitle>
          <CardDescription>
            {caseInfo
              ? `You've been invited to join case ${caseInfo.case_number} (${caseInfo.case_type})`
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
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Setting up..." : "Get started"}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm">
            <Link href="/login" className="text-primary hover:underline">Already registered? Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
