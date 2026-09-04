import { cn } from "@/lib/utils";

export type CapabilityTier = "LIVE" | "ARCHITECTED" | "ROADMAP";

export function CapabilityTag({
  tier,
  className,
}: {
  tier: CapabilityTier;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block w-24 shrink-0 text-[10px] font-medium uppercase tracking-[0.14em]",
        tier === "LIVE" && "text-[var(--sanctuary-teal)]",
        tier === "ARCHITECTED" && "text-[var(--sanctuary-terracotta)]",
        tier === "ROADMAP" && "text-[var(--sanctuary-ink-3)]",
        className
      )}
    >
      {tier}
    </span>
  );
}
