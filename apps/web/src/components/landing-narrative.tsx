"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { MeshGradient } from "@/components/mesh-gradient";
import { LivingChart } from "@/components/living-chart";
import { CountUp } from "@/components/count-up";
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

const STATUTES = [
  "SC/ST (Prevention of Atrocities) Act 1989",
  "PoA Rules 1995",
  "Witness Protection Scheme 2018",
  "Mental Healthcare Act 2017",
  "DPDP Act 2023",
  "IT Act 2000",
  "BNSS 2023 s.396",
];

function HeroTrace({ reduce }: { reduce: boolean | null }) {
  return (
    <motion.div
      aria-hidden
      className="relative mx-auto aspect-square w-full max-w-[28rem] lg:max-w-none"
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Soft atmosphere behind the mark */}
      <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle_at_40%_35%,rgba(15,111,101,0.18),transparent_58%),radial-gradient(circle_at_70%_70%,rgba(201,123,90,0.12),transparent_55%)]" />
      <div
        className="absolute inset-[18%] rounded-full border border-[var(--sanctuary-sand)]/80"
        style={{ animation: reduce ? undefined : "pulse-ring 6s ease-in-out infinite" }}
      />
      <div
        className="absolute inset-[28%] rounded-full border border-[var(--sanctuary-teal)]/25"
        style={{ animation: reduce ? undefined : "pulse-ring 6s ease-in-out 1.2s infinite" }}
      />

      <svg viewBox="0 0 400 400" className="relative h-full w-full">
        <defs>
          <linearGradient id="hero-trace" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0f6f65" stopOpacity="0.15" />
            <stop offset="45%" stopColor="#0f6f65" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#c97b5a" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        {/* Quiet baseline */}
        <path
          d="M 48 230 C 110 230, 140 228, 180 220"
          fill="none"
          stroke="var(--sanctuary-sand)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Rising distress trace */}
        <motion.path
          d="M 180 220 C 230 205, 250 160, 280 120 C 300 95, 320 78, 352 70"
          fill="none"
          stroke="url(#hero-trace)"
          strokeWidth="3.25"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.6, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
        />
        {/* Early-warning point */}
        <motion.circle
          cx="280"
          cy="120"
          r="6"
          fill="#0f6f65"
          initial={reduce ? false : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.4 }}
        />
        <motion.circle
          cx="280"
          cy="120"
          r="14"
          fill="none"
          stroke="#0f6f65"
          strokeOpacity="0.35"
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1.15, opacity: [0.45, 0.15, 0.45] }}
          transition={{ delay: 1.4, duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>

      <p className="pointer-events-none absolute bottom-[12%] left-1/2 w-[min(100%,14rem)] -translate-x-1/2 text-center text-[11px] leading-relaxed tracking-[0.04em] text-[var(--sanctuary-ink-3)]">
        The quiet climb before a crisis — seen early enough to act.
      </p>
    </motion.div>
  );
}

function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <MeshGradient />
      {/* Edge wash so the right side never reads as empty flat canvas */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-[55%] bg-[radial-gradient(ellipse_at_70%_40%,rgba(15,111,101,0.09),transparent_65%)]"
      />

      <div className="relative z-10 mx-auto grid min-h-[100svh] w-full max-w-6xl items-center gap-10 px-6 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:py-16">
        <div>
          <motion.div
            className="flex items-center gap-3.5"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
          >
            <SamvednaMark size={52} animated className="shrink-0 transition-transform hover:scale-105" />
            <div>
              <p className="font-display text-[clamp(1.75rem,4vw,2.35rem)] font-semibold tracking-tight text-[var(--sanctuary-ink)]">
                Samvedna
              </p>
              <p className="mt-0.5 text-sm font-medium text-[var(--sanctuary-ink-2)]">
                संवेदना · listening beyond words
              </p>
            </div>
          </motion.div>

          <motion.h1
            className="mt-8 max-w-xl font-display text-[clamp(2.15rem,5vw,3.85rem)] font-normal leading-[1.08] tracking-tight text-[var(--sanctuary-ink)] sm:mt-10"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
          >
            Distress leaves a trace long before a crisis.
          </motion.h1>

          <motion.p
            className="mt-6 max-w-md text-base leading-relaxed text-[var(--sanctuary-ink-2)] sm:mt-7 sm:text-[19px]"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.16 }}
          >
            Continuous mental-health monitoring for survivors of caste atrocities — across NHAA
            14566, IVRS, SMS, chatbot and the Integrated Portal.
          </motion.p>

          <motion.div
            className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10 sm:gap-4"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}
          >
            <Link
              href="/login"
              className="inline-flex items-center rounded-full bg-[var(--sanctuary-teal)] px-6 py-3 text-sm font-medium text-[#fdfbf7] no-underline shadow-sm transition hover:brightness-110"
            >
              Get started
              <span className="ml-1.5" aria-hidden>
                →
              </span>
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-full border border-[var(--sanctuary-sand)] bg-white/70 px-6 py-3 text-sm font-medium text-[var(--sanctuary-ink)] no-underline backdrop-blur transition hover:border-[var(--sanctuary-teal)]/40"
            >
              Open care desk
            </Link>
          </motion.div>
        </div>

        <HeroTrace reduce={reduce} />
      </div>
    </section>
  );
}

function Capabilities() {
  const reduce = useReducedMotion();

  return (
    <section className="mx-auto max-w-5xl px-6 py-20 sm:py-28">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sanctuary-ink-3)]">
        How Samvedna works
      </p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl leading-tight text-[var(--sanctuary-ink)] sm:text-4xl">
        Listen. Understand. Foresee. Protect.
      </h2>
      <ul className="mt-12 grid gap-8 sm:grid-cols-2">
        {CAPABILITIES.map((c, i) => (
          <motion.li
            key={c.word}
            className="border-t border-[var(--sanctuary-sand)] pt-6"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: i * 0.06, duration: 0.45 }}
          >
            <p className="font-display text-3xl text-[var(--sanctuary-teal)] sm:text-4xl">
              {c.word}
            </p>
            <p className="mt-3 text-[var(--sanctuary-ink-2)]">{c.line}</p>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

function Numbers() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <div className="border-t border-[var(--sanctuary-sand)] pt-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: 4, suffix: "d", cap: "Median early-warning lead (synthetic backtest)" },
            { n: 12, suffix: "", cap: "Languages supported" },
            { n: 0, suffix: "", cap: "PII fields transmitted to any model" },
            { n: 13, suffix: "", cap: "Statutory entitlements mapped" },
          ].map((x) => (
            <div key={x.cap}>
              <p className="font-display text-[clamp(2.75rem,5vw,4.25rem)] leading-none text-[var(--sanctuary-ink)]">
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

function SiteFooter() {
  return (
    <footer className="border-t border-[var(--sanctuary-sand)] bg-[var(--sanctuary-sand)]/20">
      <div className="mx-auto max-w-5xl px-6 py-14 sm:py-16">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2.5">
              <SamvednaMark size={28} />
              <span className="font-display text-lg font-semibold text-[var(--sanctuary-ink)]">
                Samvedna
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[var(--sanctuary-ink-2)]">
              Decision support for authorised professionals — not a clinical diagnosis and not an
              emergency service. Built for atrocity survivors under the SC/ST (Prevention of
              Atrocities) Act, 1989.
            </p>
          </div>

          <div className="space-y-6 sm:text-right">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sanctuary-ink-3)]">
                Enter
              </p>
              <div className="mt-2 flex flex-wrap gap-4 sm:justify-end">
                <Link
                  href="/login"
                  className="text-sm font-medium text-[var(--sanctuary-teal)] no-underline hover:underline"
                >
                  Survivor
                </Link>
                <Link
                  href="/login"
                  className="text-sm font-medium text-[var(--sanctuary-teal)] no-underline hover:underline"
                >
                  Counsellor
                </Link>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--sanctuary-ink-3)]">
                Crisis helplines
              </p>
              <p className="mt-2 font-display text-lg leading-snug text-[var(--sanctuary-ink)] sm:text-xl">
                112 · KIRAN 1800-599-0019
                <br />
                Tele-MANAS 14416 · NHAA 14566
              </p>
            </div>
          </div>
        </div>

        <p className="mt-12 border-t border-[var(--sanctuary-sand)] pt-6 text-[11px] leading-relaxed text-[var(--sanctuary-ink-3)]">
          {STATUTES.join(" · ")}
        </p>
      </div>
    </footer>
  );
}

export function LandingNarrative() {
  return (
    <main className="theme-sanctuary relative min-h-screen overflow-x-hidden bg-[var(--sanctuary-canvas)] text-[var(--sanctuary-ink)]">
      <Hero />
      <LivingChart />
      <Capabilities />
      <Numbers />
      <SiteFooter />
    </main>
  );
}
