"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { MeshGradient } from "@/components/mesh-gradient";
import { LivingChart } from "@/components/living-chart";
import { CountUp } from "@/components/count-up";
import { CapabilityTag, type CapabilityTier } from "@/components/capability-tag";
import { SamvednaMark } from "@/components/samvedna-logo";

const CAPABILITIES = [
  {
    word: "Listen",
    line: "Twelve languages, by voice or text, on whichever channel reaches her.",
  },
  {
    word: "Understand",
    line: "Five signal channels, anchored to PHQ-9, GAD-7 and PCL-5.",
  },
  {
    word: "Foresee",
    line: "A forecast with a stated error bar, not a claim.",
  },
  {
    word: "Protect",
    line: "Statutory entitlements, named authorities, and a clock on every one.",
  },
] as const;

const LEDGER: Array<{ tier: CapabilityTier; name: string; detail: string }> = [
  {
    tier: "LIVE",
    name: "Five-channel composite score",
    detail: "Weighted clinical · text · voice · behavioural · case context with redistribution",
  },
  {
    tier: "LIVE",
    name: "Deterministic crisis override",
    detail: "Self-harm language bypasses the model and alerts humans immediately",
  },
  {
    tier: "LIVE",
    name: "Care cadence + Gone Quiet",
    detail: "Risk-adaptive outreach; silence after grace becomes an alert",
  },
  {
    tier: "LIVE",
    name: "Explainability by construction",
    detail: "score_contributions waterfall — arithmetic, not a second model",
  },
  {
    tier: "LIVE",
    name: "POA statutory intervention catalogue",
    detail: "Thirteen entitlements with SLA, authority, and Rule citations",
  },
  {
    tier: "LIVE",
    name: "PII redaction before Gemini",
    detail: "Names, phones, Aadhaar-shaped digits replaced with typed placeholders",
  },
  {
    tier: "LIVE",
    name: "Hash-chained audit ledger",
    detail: "Append-only Postgres chain; GET /audit/verify walks integrity live",
  },
  {
    tier: "ARCHITECTED",
    name: "NHAA 14566 intake connector",
    detail: "Simulated POST /intake/nhaa — no live government API claimed",
  },
  {
    tier: "ARCHITECTED",
    name: "Exotel / IVRS telephony",
    detail: "Webhook contracts present; dispatch logs when credentials absent",
  },
  {
    tier: "ARCHITECTED",
    name: "Bhashini ASR/TTS",
    detail: "Named as production speech path; Web Speech used in the demo",
  },
  {
    tier: "ARCHITECTED",
    name: "Voice stress on personal baseline",
    detail: "Prosody endpoint live; personal baseline learns after calm samples",
  },
  {
    tier: "ARCHITECTED",
    name: "Forecast cone + crisis probability",
    detail: "Backtested on synthetic longitudinal data — prospective validation required",
  },
  {
    tier: "ROADMAP",
    name: "Conversational clinical instruments",
    detail: "PHQ/GAD/PCL/C-SSRS woven into Mann-Mitra without survey forms",
  },
  {
    tier: "ROADMAP",
    name: "Cluster & contagion detection",
    detail: "Village-level intimidation campaigns surfaced to DM / SP",
  },
  {
    tier: "ROADMAP",
    name: "Intervention simulator",
    detail: "Counterfactual benefit-per-counsellor-hour triage for officials",
  },
];

const STATUTES = [
  "SC/ST (Prevention of Atrocities) Act 1989",
  "PoA Rules 1995",
  "Witness Protection Scheme 2018",
  "Mental Healthcare Act 2017",
  "DPDP Act 2023",
  "IT Act 2000",
  "BNSS 2023 s.396",
];

function Hero() {
  const reduce = useReducedMotion();
  const words = "Distress leaves a trace long before a crisis.".split(" ");

  return (
    <section className="relative flex min-h-screen items-center overflow-hidden">
      <MeshGradient />
      <div className="relative mx-auto w-full max-w-5xl px-6 pb-24 pt-28">
        <div className="flex items-center gap-3.5 mb-3">
          <SamvednaMark size={48} animated className="hover:scale-105 transition-transform" />
          <div>
            <p className="text-[12px] font-semibold tracking-[0.35em] text-[var(--sanctuary-ink-3)]">SAMVEDNA</p>
            <p className="mt-0.5 text-sm text-[var(--sanctuary-ink-2)] font-medium">
              संवेदना · listening beyond words
            </p>
          </div>
        </div>
        <h1 className="mt-10 max-w-4xl font-display text-[clamp(3.5rem,8vw,7rem)] font-normal leading-[0.92] text-[var(--sanctuary-ink)]">
          {words.map((w, i) => (
            <motion.span
              key={`${w}-${i}`}
              className="mr-[0.22em] inline-block"
              initial={reduce ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: reduce ? 0 : i * 0.04,
                duration: 0.55,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {w}
            </motion.span>
          ))}
        </h1>
        <p className="mt-8 max-w-xl text-[19px] leading-relaxed text-[var(--sanctuary-ink-2)]">
          Continuous mental-health monitoring for survivors of caste atrocities — across NHAA
          14566, IVRS, SMS, chatbot and the Integrated Portal.
        </p>
        <div className="mt-10 flex flex-wrap gap-8 text-[15px]">
          <Link
            href="/login"
            className="group text-[var(--sanctuary-ink)] underline decoration-transparent underline-offset-8 transition hover:decoration-[var(--sanctuary-teal)]"
          >
            Enter
            <span className="ml-1 inline-block transition group-hover:translate-x-1">→</span>
          </Link>
          <Link
            href="/login"
            className="text-[var(--sanctuary-ink-2)] underline decoration-transparent underline-offset-8 transition hover:decoration-[var(--sanctuary-sand)]"
          >
            For officials
          </Link>
          <Link
            href="/brand"
            className="text-[var(--sanctuary-ink-2)] underline decoration-transparent underline-offset-8 transition hover:decoration-[var(--sanctuary-sand)] inline-flex items-center gap-1.5"
          >
            <span>Brand identity</span>
            <span className="text-[10px] bg-teal-800/10 text-teal-800 px-1.5 py-0.5 rounded font-mono font-medium">SVG</span>
          </Link>
        </div>
        <div
          aria-hidden
          className="absolute bottom-10 left-1/2 h-10 w-px -translate-x-1/2 bg-[var(--sanctuary-teal)]"
          style={{ animation: "pulse-line 2s ease-in-out infinite" }}
        />
      </div>
    </section>
  );
}

function Capabilities() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const idx = useTransform(scrollYProgress, [0, 0.25, 0.5, 0.75, 1], [0, 1, 2, 3, 3]);
  const [active, setActive] = useState(0);
  useMotionValueEvent(idx, "change", (v) => setActive(Math.round(v)));

  return (
    <section ref={ref} className="relative h-[220vh]">
      <div className="sticky top-0 flex h-screen items-center">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-12 px-6 lg:grid-cols-2">
          <ul className="space-y-3">
            {CAPABILITIES.map((c, i) => (
              <li
                key={c.word}
                className="font-display text-[clamp(2.5rem,5vw,4rem)] leading-none transition-opacity duration-500"
                style={{
                  opacity: reduce || active === i ? 1 : 0.12,
                  color: "var(--sanctuary-ink)",
                }}
              >
                {c.word}
              </li>
            ))}
          </ul>
          <p className="max-w-md self-center text-lg text-[var(--sanctuary-ink-2)]">
            {CAPABILITIES[active]?.line}
          </p>
        </div>
      </div>
    </section>
  );
}

function Numbers() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-28">
      <div className="border-t border-[var(--sanctuary-sand)] pt-16">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: 4, suffix: "d", cap: "Median early-warning lead (synthetic backtest)" },
            { n: 12, suffix: "", cap: "Languages supported" },
            { n: 0, suffix: "", cap: "PII fields transmitted to any model" },
            { n: 13, suffix: "", cap: "Statutory entitlements mapped" },
          ].map((x) => (
            <div key={x.cap}>
              <p className="font-display text-[clamp(3rem,6vw,5rem)] leading-none text-[var(--sanctuary-ink)]">
                <CountUp value={x.n} suffix={x.suffix} />
              </p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-[var(--sanctuary-ink-3)]">
                {x.cap}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Ledger() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <h2 className="font-display text-3xl text-[var(--sanctuary-ink)]">Capability ledger</h2>
      <p className="mt-2 text-[var(--sanctuary-ink-2)]">
        What runs now, what is contracted, and what is designed — labelled plainly.
      </p>
      <ul className="mt-12">
        {LEDGER.map((row) => (
          <li
            key={row.name}
            className="flex gap-4 border-t border-[var(--sanctuary-sand)] py-5 first:border-t-0"
          >
            <CapabilityTag tier={row.tier} />
            <div>
              <p className="text-[var(--sanctuary-ink)]">{row.name}</p>
              <p className="mt-1 text-sm text-[var(--sanctuary-ink-2)]">{row.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LandingNarrative() {
  return (
    <main className="theme-sanctuary relative min-h-screen overflow-x-hidden">
      <Hero />
      <LivingChart />
      <Capabilities />
      <Numbers />
      <Ledger />

      <section className="mx-auto max-w-5xl border-t border-[var(--sanctuary-sand)] px-6 py-16">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--sanctuary-ink-3)]">
          {STATUTES.join(" · ")}
        </p>
      </section>

      <footer className="mx-auto max-w-5xl px-6 pb-20 pt-8">
        <p className="font-display text-3xl leading-snug text-[var(--sanctuary-ink)] sm:text-4xl">
          112 · KIRAN 1800-599-0019 · Tele-MANAS 14416 · NHAA 14566
        </p>
        <p className="mt-6 max-w-2xl text-sm text-[var(--sanctuary-ink-2)]">
          Decision support for authorised professionals — not a clinical diagnosis and not an
          emergency service. Built for atrocity survivors and complainants under the SC/ST
          (Prevention of Atrocities) Act, 1989.
        </p>
      </footer>
    </main>
  );
}
