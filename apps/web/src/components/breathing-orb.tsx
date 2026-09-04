"use client";

import { cn } from "@/lib/utils";

export function BreathingOrb({
  onActivate,
  className,
}: {
  onActivate?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label="Begin check-in"
      className={cn(
        "relative mx-auto flex h-44 w-44 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sanctuary-teal)]",
        className
      )}
    >
      <span
        aria-hidden
        className="breathing-orb absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 40% 35%, rgba(15,111,101,0.35), rgba(15,111,101,0.08) 55%, transparent 70%)",
        }}
      />
      <span className="relative text-sm tracking-wide text-[var(--sanctuary-ink-2)]">
        tap to begin
      </span>
    </button>
  );
}
