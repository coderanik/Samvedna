"use client";

import { cn } from "@/lib/utils";

export function MeshGradient({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 mesh-drift", className)}
    />
  );
}
