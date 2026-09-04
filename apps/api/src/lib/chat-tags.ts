/**
 * Tag extraction for chatbot → exercises mapping.
 * Deterministic keyword rules (explainable v1) — not a black-box model.
 */

const TAG_RULES: Array<{ tag: string; patterns: RegExp[] }> = [
  {
    tag: "anxiety",
    patterns: [
      /\banxious\b/i,
      /\banxiety\b/i,
      /\bpanic\b/i,
      /\bworr(?:y|ied|ies)\b/i,
      /\bnervous\b/i,
      /\bचिंता\b/,
      /\bघबराहट\b/,
    ],
  },
  {
    tag: "sleep",
    patterns: [
      /\binsomnia\b/i,
      /\bcan'?t sleep\b/i,
      /\bsleepless\b/i,
      /\bnightmare/i,
      /\bनींद\b/,
      /\bsleep (?:issues?|problems?|trouble)\b/i,
    ],
  },
  {
    tag: "harassment",
    patterns: [
      /\bharass/i,
      /\bthreat/i,
      /\bstalk/i,
      /\bintimidate/i,
      /\bडर\b/,
      /\bधमक/i,
    ],
  },
  {
    tag: "depression",
    patterns: [
      /\bdepress/i,
      /\bhopeless\b/i,
      /\bempty\b/i,
      /\bno energy\b/i,
      /\bउदास\b/,
      /\bनिराश\b/,
    ],
  },
  {
    tag: "anger",
    patterns: [/\bang(?:er|ry)\b/i, /\brage\b/i, /\bfurious\b/i, /\bगुस्सा\b/],
  },
  {
    tag: "loneliness",
    patterns: [/\blonely\b/i, /\balone\b/i, /\bisolated\b/i, /\bअकेला\b/, /\btanha\b/i],
  },
];

export function extractProblemTags(text: string): string[] {
  if (!text?.trim()) return [];
  const found = new Set<string>();
  for (const rule of TAG_RULES) {
    if (rule.patterns.some((p) => p.test(text))) found.add(rule.tag);
  }
  return [...found];
}
