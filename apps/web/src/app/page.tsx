import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { homeForRole, resolveUserRole } from "@/lib/auth";
import { Heart } from "lucide-react";

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
    redirect(homeForRole(resolveUserRole(user, profile)));
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-50 via-background to-stone-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-900/10">
            <Heart className="h-6 w-6 text-teal-900" />
          </div>
          <div>
            <p className="text-sm font-medium tracking-[0.2em] text-teal-900/70">SAMVEDNA</p>
            <p className="text-xs text-muted-foreground">संवेदना · listening beyond words</p>
          </div>
        </div>

        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-teal-950 sm:text-5xl">
          Dynamic mental health monitoring for victims & witnesses
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-teal-950/70">
          Continuously listen across chatbot, mobile, portal, IVRS and helpline channels —
          understand distress, predict escalation, prioritise cases, and connect people to
          human care through investigation, trial, compensation and rehabilitation.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-4">
          {["Detect", "Understand", "Predict", "Intervene"].map((step) => (
            <div
              key={step}
              className="rounded-2xl border border-teal-900/10 bg-white/70 px-4 py-5 backdrop-blur"
            >
              <p className="text-sm font-semibold text-teal-950">{step}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-full bg-teal-900 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-800"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-full border border-teal-900/20 bg-white/80 px-6 py-3 text-sm font-semibold text-teal-950 hover:bg-white"
          >
            Create victim account
          </Link>
        </div>

        <p className="mt-12 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Support tool — not an emergency service. Emergency: <strong>112</strong> · KIRAN:{" "}
          <strong>1800-599-0019</strong> · NHAA atrocity helpline: <strong>14566</strong>.
          AI outputs are triage decision-support for authorised professionals, not clinical
          diagnoses. NHAA / Exotel connectors are architected; live government telephony
          requires deployment credentials.
        </p>
      </div>
    </main>
  );
}
