"use client";

import { useState } from "react";

const LINES = [
  { label: "Emergency", value: "112", href: "tel:112" },
  { label: "KIRAN", value: "1800-599-0019", href: "tel:18005990019" },
  { label: "Tele-MANAS", value: "14416", href: "tel:14416" },
  { label: "NHAA", value: "14566", href: "tel:14566" },
];

export function CrisisSheet({ locale = "en" }: { locale?: string }) {
  const [open, setOpen] = useState(false);
  const title =
    locale === "hi"
      ? "अभी मदद चाहिए"
      : locale === "ta"
        ? "இப்போது உதவி வேண்டும்"
        : "I need help now";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-[var(--sanctuary-ink-2)] underline decoration-[var(--sanctuary-sand)] underline-offset-4 transition hover:text-[var(--sanctuary-teal)]"
      >
        {title}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal
          aria-label={title}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md bg-[var(--sanctuary-canvas)] p-8 shadow-[0_1px_40px_rgba(15,111,101,0.08)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-2xl text-[var(--sanctuary-ink)]">
              You do not have to explain first.
            </p>
            <p className="mt-2 text-[var(--sanctuary-ink-2)]">
              These lines are staffed by humans. Call whichever you can reach.
            </p>
            <ul className="mt-8 space-y-4">
              {LINES.map((l) => (
                <li key={l.value} className="flex items-baseline justify-between gap-4">
                  <span className="text-sm text-[var(--sanctuary-ink-3)]">{l.label}</span>
                  <a
                    href={l.href}
                    className="font-display text-2xl text-[var(--sanctuary-teal)] hover:underline"
                  >
                    {l.value}
                  </a>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-8 text-sm text-[var(--sanctuary-ink-2)] underline underline-offset-4"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
