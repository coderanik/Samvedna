"use client";

import { motion, useReducedMotion } from "framer-motion";

const COPY = [
  "Every check-in leaves a signal.",
  "The signal has a direction.",
  "Direction is a warning you can act on.",
] as const;

/**
 * Distress trajectory — full chart visible in one viewport (no sticky empty scroll).
 */
export function LivingChart() {
  const reduce = useReducedMotion();

  const climb =
    "M 40 240 C 180 240, 260 200, 340 160 C 420 120, 500 70, 580 50";
  const recover = "M 580 50 C 660 55, 740 120, 820 180";

  return (
    <section className="border-y border-[var(--sanctuary-sand)] bg-[var(--sanctuary-sand)]/15 py-16 sm:py-24">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-[1fr_1.35fr] lg:gap-14">
        <div className="space-y-5">
          {COPY.map((text, i) => (
            <motion.p
              key={text}
              className="font-display text-2xl leading-snug text-[var(--sanctuary-ink)] sm:text-3xl md:text-4xl"
              initial={reduce ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              {text}
            </motion.p>
          ))}
        </div>

        <motion.svg
          viewBox="0 0 900 320"
          className="h-auto w-full min-h-[220px] text-[var(--sanctuary-ink)]"
          aria-hidden
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.6 }}
        >
          <line
            x1="40"
            y1="40"
            x2="40"
            y2="280"
            stroke="currentColor"
            strokeOpacity="0.15"
          />
          <line
            x1="40"
            y1="280"
            x2="860"
            y2="280"
            stroke="currentColor"
            strokeOpacity="0.15"
          />
          <line
            x1="40"
            y1="98"
            x2="860"
            y2="98"
            stroke="#c97b5a"
            strokeOpacity="0.45"
            strokeDasharray="4 6"
          />
          <text
            x="48"
            y="90"
            fill="#93a19f"
            fontSize="11"
            fontFamily="var(--font-sans), system-ui, sans-serif"
          >
            crisis threshold
          </text>
          <motion.path
            d={climb}
            fill="none"
            stroke="#0f6f65"
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
          <motion.path
            d={recover}
            fill="none"
            stroke="#0f6f65"
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.55, ease: "easeOut" }}
          />
          <motion.g
            initial={reduce ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 1.1, duration: 0.4 }}
          >
            <circle cx="580" cy="50" r="5" fill="#c97b5a" />
            <text
              x="592"
              y="46"
              fill="#c97b5a"
              fontSize="12"
              fontFamily="var(--font-sans), system-ui, sans-serif"
            >
              counselling dispatched
            </text>
          </motion.g>
        </motion.svg>
      </div>
    </section>
  );
}
