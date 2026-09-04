/**
 * PII redaction applied before any transcript leaves the process for an LLM.
 *
 * The placeholder map is returned to the caller for local re-hydration only —
 * it is never included in an outbound request body and never persisted.
 */

export type RedactionEntityType =
  | "NAME"
  | "PHONE"
  | "EMAIL"
  | "AADHAAR"
  | "VILLAGE"
  | "ID";

export interface RedactionResult {
  redacted: string;
  entityCount: number;
  /** placeholder → original value. Local only. */
  map: Record<string, string>;
}

export interface RedactionStats {
  calls: number;
  entities_redacted: number;
  by_type: Record<RedactionEntityType, number>;
  last_redaction_at: string | null;
}

const stats: RedactionStats = {
  calls: 0,
  entities_redacted: 0,
  by_type: { NAME: 0, PHONE: 0, EMAIL: 0, AADHAAR: 0, VILLAGE: 0, ID: 0 },
  last_redaction_at: null,
};

export function getRedactionStats(): RedactionStats {
  return { ...stats, by_type: { ...stats.by_type } };
}

export function resetRedactionStats() {
  stats.calls = 0;
  stats.entities_redacted = 0;
  stats.last_redaction_at = null;
  for (const key of Object.keys(stats.by_type) as RedactionEntityType[]) {
    stats.by_type[key] = 0;
  }
}

/**
 * Modest list of common Indian given names and surnames. Deliberately short:
 * a long list produces false positives on ordinary Hindi/Tamil words, and the
 * victim's own name tokens are always passed in explicitly by the caller.
 */
const COMMON_NAMES = [
  "aarti", "abhishek", "aditya", "ajay", "akash", "amit", "anita", "anjali",
  "ankit", "anu", "arjun", "arun", "asha", "ashok", "babu", "bhavna", "chandra",
  "deepa", "deepak", "devi", "dinesh", "ganesh", "gauri", "geeta", "gopal",
  "hari", "kamala", "kavita", "kiran", "krishna", "lakshmi", "lalita", "mahesh",
  "manju", "manoj", "meena", "mohan", "muthu", "nandini", "naveen", "neha",
  "pooja", "prakash", "pramod", "priya", "radha", "raj", "rajesh", "raju",
  "rakesh", "ram", "ramesh", "rani", "ravi", "rekha", "renu", "sanjay",
  "santosh", "saraswati", "savita", "seema", "selvi", "shanti", "sharma",
  "shiva", "sita", "sonia", "subhash", "sudha", "sujata", "sunil", "sunita",
  "suresh", "usha", "vijay", "vikas", "vinod",
  // surnames / community names that commonly appear in POA Act complaints
  "chauhan", "gupta", "jadhav", "kumar", "meena", "murugan", "nayak", "pandey",
  "patel", "rathod", "singh", "solanki", "thakur", "valmiki", "verma", "yadav",
];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/**
 * 12 digits, optionally grouped 4-4-4. Runs before phone so it wins the digits,
 * except after a "+" — "+919876543210" is a country code plus a mobile, not an
 * Aadhaar, and it is also 12 digits long.
 */
const AADHAAR_RE = /(?<!\+)\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b(?!\d)/g;
/**
 * Indian mobile with an optional +91 or leading-0 prefix, in the three groupings
 * people actually type: contiguous, 5+5, and 3+3+4. The digit lookarounds do the
 * work that \b cannot, since \b never fires between the "91" prefix and the number.
 */
const PHONE_RE =
  /(?<!\d)(?:\+?\s*91[\s-]?|0)?(?:[6-9]\d{2}[\s-]\d{3}[\s-]\d{4}|[6-9]\d{4}[\s-]\d{5}|[6-9]\d{9})(?!\d)/g;
/** "village Kadapa", "Kadapa village", "गांव X", "gaon X". */
const VILLAGE_RE =
  /\b(?:village|gaon|gram|grama|ooru|कस्बा|गांव|गाँव|ग्राम|கிராமம்)\s+([A-Za-z\u0900-\u097F\u0B80-\u0BFF][\w\u0900-\u097F\u0B80-\u0BFF]{2,})\b|\b([A-Z][a-z]{2,})\s+(?:village|gaon)\b/g;
/** FIR / case / crime numbers: NHAA-1234, FIR 45/2024, CR No 12/2023. */
const ID_RE =
  /\b(?:(?:FIR|CR|RC|NHAA|POA|CNR)[\s.:/-]*(?:no\.?|number)?[\s.:/-]*[A-Za-z0-9]*\d{2,}(?:\/\d{2,4})?|\b[A-Z]{2,5}-\d{3,}\b)/gi;

function bumpStats(type: RedactionEntityType, n: number) {
  if (n <= 0) return;
  stats.by_type[type] += n;
  stats.entities_redacted += n;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Name tokens worth redacting — drops initials, honorifics and short particles. */
function nameTokens(fullNames: string[]): string[] {
  const HONORIFICS = new Set(["mr", "mrs", "ms", "dr", "shri", "smt", "kumari", "sri"]);
  const out = new Set<string>();
  for (const name of fullNames) {
    if (!name) continue;
    for (const raw of name.split(/[\s.,]+/)) {
      const token = raw.trim();
      if (token.length < 3) continue;
      if (HONORIFICS.has(token.toLowerCase())) continue;
      out.add(token);
    }
    const whole = name.trim();
    if (whole.includes(" ") && whole.length >= 5) out.add(whole);
  }
  // Longest first so "Ramesh Kumar" is replaced before "Ramesh".
  return [...out].sort((a, b) => b.length - a.length);
}

export interface RedactOptions {
  /** Names known from the case record (victim, accused, witnesses). */
  knownNames?: string[];
  /** Also scan for the built-in common-name list. Default true. */
  useCommonNames?: boolean;
}

export function redactPii(input: string, opts: RedactOptions = {}): RedactionResult {
  stats.calls += 1;

  if (!input) {
    return { redacted: "", entityCount: 0, map: {} };
  }

  const map: Record<string, string> = {};
  let text = input;
  let entityCount = 0;

  // Structured identifiers first: they contain digits and letters that the
  // name pass would otherwise fragment.
  const replaceAll = (re: RegExp, type: RedactionEntityType, placeholder: string) => {
    let hits = 0;
    text = text.replace(re, (match) => {
      hits += 1;
      map[placeholder] = match.trim();
      return placeholder;
    });
    bumpStats(type, hits);
    entityCount += hits;
  };

  replaceAll(EMAIL_RE, "EMAIL", "[EMAIL]");
  replaceAll(AADHAAR_RE, "AADHAAR", "[AADHAAR]");
  replaceAll(PHONE_RE, "PHONE", "[PHONE]");
  replaceAll(ID_RE, "ID", "[ID]");

  let villageHits = 0;
  text = text.replace(VILLAGE_RE, (match, after: string | undefined, before: string | undefined) => {
    const value = (after ?? before ?? "").trim();
    if (!value) return match;
    villageHits += 1;
    map["[VILLAGE]"] = value;
    return "[VILLAGE]";
  });
  bumpStats("VILLAGE", villageHits);
  entityCount += villageHits;

  // Names get numbered placeholders so the LLM can still track who is who.
  const candidates = [
    ...nameTokens(opts.knownNames ?? []),
    ...(opts.useCommonNames === false ? [] : COMMON_NAMES),
  ];

  let nameIndex = 0;
  const assigned = new Map<string, string>();
  let nameHits = 0;

  for (const candidate of candidates) {
    const re = new RegExp(`\\b${escapeRegex(candidate)}\\b`, "gi");
    if (!re.test(text)) continue;
    re.lastIndex = 0;

    const key = candidate.toLowerCase();
    let placeholder = assigned.get(key);
    if (!placeholder) {
      nameIndex += 1;
      placeholder = `[NAME_${nameIndex}]`;
      assigned.set(key, placeholder);
    }

    text = text.replace(re, (match) => {
      nameHits += 1;
      map[placeholder!] = match;
      return placeholder!;
    });
  }
  bumpStats("NAME", nameHits);
  entityCount += nameHits;

  if (entityCount > 0) stats.last_redaction_at = new Date().toISOString();

  return { redacted: text, entityCount, map };
}

/** Redact without keeping a map — for text that will never be re-hydrated. */
export function redactForLog(input: string, opts: RedactOptions = {}): string {
  return redactPii(input, opts).redacted;
}
