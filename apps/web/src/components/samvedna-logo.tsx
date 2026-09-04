import React from "react";
import { cn } from "@/lib/utils";

export interface SamvednaLogoProps {
  variant?: "icon" | "emblem" | "horizontal" | "stacked" | "badge";
  size?: "xs" | "sm" | "md" | "lg" | "xl" | number;
  theme?: "auto" | "light" | "dark";
  animated?: boolean;
  className?: string;
  showTagline?: boolean;
}

const SIZE_MAP = {
  xs: { icon: 20, font: "text-sm", subfont: "text-[10px]" },
  sm: { icon: 28, font: "text-base", subfont: "text-[11px]" },
  md: { icon: 38, font: "text-xl", subfont: "text-xs" },
  lg: { icon: 48, font: "text-2xl", subfont: "text-sm" },
  xl: { icon: 64, font: "text-3xl", subfont: "text-base" },
};

/**
 * Samvedna Logo Vector Mark
 * Symbolism:
 * - Embracing Wings / Caring Hands: Dignity, protection, unconditional sanctuary.
 * - Heart & Lotus Petals: Healing rising from adversity, emotional solidarity.
 * - Acoustic Ripples: "Listening beyond words" — catching distress frequency.
 * - Bindu (Radiant Dot): Consciousness, awareness, and active empathetic listening.
 */
export function SamvednaMark({
  size = 36,
  animated = false,
  className,
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  const idSuffix = React.useId().replace(/:/g, "_");

  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={cn("shrink-0 transition-transform duration-300", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Samvedna Emblem"
    >
      <defs>
        <linearGradient id={`markGold_${idSuffix}`} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#c97b5a" />
          <stop offset="50%" stopColor="#f4a261" />
          <stop offset="100%" stopColor="#ffd166" />
        </linearGradient>

        <linearGradient id={`markTeal_${idSuffix}`} x1="0%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%" stopColor="#0b524b" />
          <stop offset="40%" stopColor="#0f6f65" />
          <stop offset="80%" stopColor="#2a9d8f" />
          <stop offset="100%" stopColor="#52b788" />
        </linearGradient>

        <linearGradient id={`markLeftWing_${idSuffix}`} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#09433d" />
          <stop offset="50%" stopColor="#127c71" />
          <stop offset="100%" stopColor="#48cae4" />
        </linearGradient>

        <linearGradient id={`markRightWing_${idSuffix}`} x1="100%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#09433d" />
          <stop offset="50%" stopColor="#2a9d8f" />
          <stop offset="100%" stopColor="#83c5be" />
        </linearGradient>

        <radialGradient id={`markBindu_${idSuffix}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#ffd166" />
          <stop offset="100%" stopColor="#f4a261" stopOpacity="0" />
        </radialGradient>

        <filter id={`markShadow_${idSuffix}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#0f6f65" floodOpacity="0.22" />
        </filter>
      </defs>

      <g filter={`url(#markShadow_${idSuffix})`}>
        {/* Acoustic Resonance Waves (Listening Beyond Words) */}
        <path
          d="M 184,188 C 204,164 228,152 256,152 C 284,152 308,164 328,188"
          fill="none"
          stroke={`url(#markGold_${idSuffix})`}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeOpacity="0.55"
          className={animated ? "animate-pulse" : ""}
          style={animated ? { animationDuration: "3s" } : undefined}
        />
        <path
          d="M 198,206 C 214,188 234,178 256,178 C 278,178 298,188 314,206"
          fill="none"
          stroke={`url(#markTeal_${idSuffix})`}
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeOpacity="0.8"
          className={animated ? "animate-pulse" : ""}
          style={animated ? { animationDuration: "2.4s", animationDelay: "0.3s" } : undefined}
        />
        <path
          d="M 214,224 C 226,210 240,202 256,202 C 272,202 286,210 298,224"
          fill="none"
          stroke={`url(#markGold_${idSuffix})`}
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeOpacity="1"
          className={animated ? "animate-pulse" : ""}
          style={animated ? { animationDuration: "1.8s", animationDelay: "0.6s" } : undefined}
        />

        {/* Protective Sanctuary Hands / Outer Wings */}
        <path
          d="M 256,416 C 206,416 142,382 116,328 C 92,278 94,212 122,158 C 132,138 148,124 168,118 C 178,115 188,121 190,131 C 192,141 187,151 177,156 C 158,166 146,182 138,202 C 122,240 124,288 150,324 C 174,358 214,380 256,380 Z"
          fill={`url(#markLeftWing_${idSuffix})`}
        />
        <path
          d="M 256,416 C 306,416 370,382 396,328 C 420,278 418,212 390,158 C 380,138 364,124 344,118 C 334,115 324,121 322,131 C 320,141 325,151 335,156 C 354,166 366,182 374,202 C 390,240 388,288 362,324 C 338,358 298,380 256,380 Z"
          fill={`url(#markRightWing_${idSuffix})`}
        />

        {/* Inner Lotus Sanctuary Petals */}
        <path
          d="M 256,370 C 224,352 182,316 174,266 C 168,228 184,196 206,182 C 216,176 226,180 228,190 C 230,198 226,206 218,212 C 204,222 196,242 198,266 C 202,298 230,328 256,344 Z"
          fill={`url(#markTeal_${idSuffix})`}
        />
        <path
          d="M 256,370 C 288,352 330,316 338,266 C 344,228 328,196 306,182 C 296,176 286,180 284,190 C 282,198 286,206 294,212 C 308,222 316,242 314,266 C 310,298 282,328 256,344 Z"
          fill={`url(#markTeal_${idSuffix})`}
        />

        {/* Central Heart of Compassion (संवेदना) */}
        <path
          d="M 256,346 C 242,330 208,296 208,260 C 208,232 228,214 250,214 C 253,214 256,215 256,215 C 256,215 259,214 262,214 C 284,214 304,232 304,260 C 304,296 270,330 256,346 Z"
          fill={`url(#markGold_${idSuffix})`}
        />

        {/* Center Radiant Flame */}
        <path
          d="M 256,150 C 245,178 240,204 246,226 C 248,232 253,236 256,236 C 259,236 264,232 266,226 C 272,204 267,178 256,150 Z"
          fill={`url(#markGold_${idSuffix})`}
        />

        {/* Bindu (The Sacred Listening Dot) */}
        <circle cx="256" cy="116" r="18" fill={`url(#markBindu_${idSuffix})`} />
        <circle cx="256" cy="116" r="9" fill="#ffffff" />
        <circle cx="256" cy="116" r="5" fill="#ffd166" />
      </g>
    </svg>
  );
}

/**
 * Full Samvedna Logo with multiple layout options
 */
export function SamvednaLogo({
  variant = "horizontal",
  size = "md",
  theme = "auto",
  animated = false,
  className,
  showTagline = true,
}: SamvednaLogoProps) {
  const isCustomSize = typeof size === "number";
  const sizeConfig = !isCustomSize ? SIZE_MAP[size] : { icon: size, font: "text-lg", subfont: "text-xs" };
  const iconPx = isCustomSize ? size : sizeConfig.icon;

  const isDark = theme === "dark";

  if (variant === "icon") {
    return <SamvednaMark size={iconPx} animated={animated} className={className} />;
  }

  if (variant === "emblem") {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center rounded-2xl p-2.5 shadow-lg transition-all hover:scale-105",
          "bg-gradient-to-br from-[#0a1f1d] via-[#0e3833] to-[#14211f] border border-[#f4a261]/25",
          className
        )}
        style={{ width: iconPx + 16, height: iconPx + 16 }}
      >
        <div className="absolute inset-0 rounded-2xl bg-teal-500/10 blur-md pointer-events-none" />
        <SamvednaMark size={iconPx} animated={animated} />
      </div>
    );
  }

  if (variant === "stacked") {
    return (
      <div className={cn("inline-flex flex-col items-center text-center gap-2", className)}>
        <SamvednaMark size={iconPx * 1.3} animated={animated} />
        <div className="flex flex-col items-center">
          <span
            className={cn(
              "font-display tracking-[0.18em] font-semibold",
              sizeConfig.font,
              isDark ? "text-[#fdfbf7]" : "text-[var(--sanctuary-ink,#14211f)]"
            )}
          >
            SAMVEDNA
          </span>
          {showTagline && (
            <span
              className={cn(
                "font-sans tracking-wider mt-0.5",
                sizeConfig.subfont,
                isDark ? "text-[#93a19f]" : "text-[var(--sanctuary-ink-2,#5a6b69)]"
              )}
            >
              <span className="font-semibold text-teal-600 dark:text-teal-400">संवेदना</span>
              <span className="opacity-60"> · listening beyond words</span>
            </span>
          )}
        </div>
      </div>
    );
  }

  if (variant === "badge") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-sm transition-all",
          isDark
            ? "bg-[#0f2e29]/70 border-teal-800/60 text-[#fdfbf7]"
            : "bg-white/85 border-[#e8dcc8] text-[#14211f] backdrop-blur-sm",
          className
        )}
      >
        <SamvednaMark size={iconPx * 0.75} animated={animated} />
        <div className="flex items-center gap-1.5 leading-none">
          <span className="font-display font-semibold tracking-wider text-sm">SAMVEDNA</span>
          <span className="text-[10px] text-teal-700 dark:text-teal-300 font-medium">संवेदना</span>
        </div>
      </div>
    );
  }

  // Default: Horizontal Lockup
  return (
    <div className={cn("inline-flex items-center gap-3 select-none", className)}>
      <SamvednaMark size={iconPx} animated={animated} />
      <div className="flex flex-col justify-center leading-tight">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-display tracking-[0.14em] font-semibold",
              sizeConfig.font,
              isDark ? "text-[#fdfbf7]" : "text-[var(--sanctuary-ink,#14211f)]"
            )}
          >
            SAMVEDNA
          </span>
          <span
            className={cn(
              "font-sans font-medium text-xs px-1.5 py-0.5 rounded tracking-wide",
              isDark
                ? "bg-teal-900/60 text-teal-300 border border-teal-700/40"
                : "bg-teal-50 text-teal-800 border border-teal-200/60"
            )}
          >
            संवेदना
          </span>
        </div>
        {showTagline && (
          <span
            className={cn(
              "font-sans tracking-wide text-xs opacity-75 mt-0.5",
              sizeConfig.subfont,
              isDark ? "text-[#93a19f]" : "text-[var(--sanctuary-ink-2,#5a6b69)]"
            )}
          >
            listening beyond words
          </span>
        )}
      </div>
    </div>
  );
}

export default SamvednaLogo;
