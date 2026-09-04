/** Deterministic crisis override — never leave suicide/threat disclosure to LLM alone. */

const CRISIS_PATTERNS: RegExp[] = [
  /\b(kill myself|suicide|end my life|want to die|self[-\s]?harm)\b/i,
  /\b(marna chahta|marna chahti|aatmahatya|khudkushi|jaan de dunga|jaan de dungi)\b/i,
  /\b(தற்கொலை|செத்துவிட)\b/i,
  /\b(they will (kill|rape|burn) (me|us)|going to kill me|active threat)\b/i,
  /\b(goli maar|jaan se maar|jaan se maarne)\b/i,
];

export function detectCrisis(transcript: string): {
  override: boolean;
  reason: string | null;
} {
  const text = transcript.trim();
  for (const re of CRISIS_PATTERNS) {
    if (re.test(text)) {
      return {
        override: true,
        reason: `Crisis language matched (${re.source.slice(0, 40)}…) — immediate human escalation required.`,
      };
    }
  }
  return { override: false, reason: null };
}
