"use client";

import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { useRef, useState } from "react";

const COPY = [
  "Every check-in leaves a signal.",
  "The signal has a direction.",
  "Direction is a warning you can act on.",
] as const;

/** Sticky scroll-driven distress trajectory — thesis without a word of pitch copy. */
export function LivingChart() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  const pathLength = useTransform(scrollYProgress, [0, 0.4], [0.08, 1]);
  const pathLength2 = useTransform(scrollYProgress, [0.42, 0.78], [0, 1]);
  const interveneOpacity = useTransform(scrollYProgress, [0.38, 0.48], [0, 1]);
  const copyIdx = useTransform(scrollYProgress, [0, 0.28, 0.55, 1], [0, 1, 2, 2]);
  const [active, setActive] = useState(0);
  useMotionValueEvent(copyIdx, "change", (v) => setActive(Math.round(v)));

  // Climb 30→80 then bend toward 40. ViewBox 0 0 900 320; y inverted for SVG.
  const climb =
    "M 40 240 C 180 240, 260 200, 340 160 C 420 120, 500 70, 580 50";
  const recover = "M 580 50 C 660 55, 740 120, 820 180";

  return (
    <section ref={ref} className="relative h-[220vh]">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-[1fr_1.4fr]">
          <div className="relative min-h-[7.5rem]">
            {reduce ? (
              <ul className="space-y-4">
                {COPY.map((text) => (
                  <li
                    key={text}
                    className="font-display text-3xl leading-snug text-[var(--sanctuary-ink)] sm:text-4xl"
                  >
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              COPY.map((text, i) => (
                <p
                  key={text}
                  aria-hidden={active !== i}
                  className="absolute inset-x-0 top-0 font-display text-3xl leading-snug text-[var(--sanctuary-ink)] transition-opacity duration-500 sm:text-4xl"
                  style={{
                    opacity: active === i ? 1 : 0,
                    pointerEvents: active === i ? "auto" : "none",
                  }}
                >
                  {text}
                </p>
              ))
            )}
          </div>

          <svg
            viewBox="0 0 900 320"
            className="h-auto w-full min-h-[200px] text-[var(--sanctuary-ink)]"
            aria-hidden
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
            {/* Crisis threshold at score 76 ≈ y = 280 - 76*2.4 ≈ 97.6 */}
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
              style={{ pathLength: reduce ? 1 : pathLength }}
            />
            <motion.path
              d={recover}
              fill="none"
              stroke="#0f6f65"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ pathLength: reduce ? 1 : pathLength2 }}
            />
            <motion.g style={{ opacity: reduce ? 1 : interveneOpacity }}>
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
          </svg>
        </div>
      </div>
    </section>
  );
}
