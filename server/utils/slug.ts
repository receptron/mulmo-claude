import { createHash } from "crypto";
import { SLUG_PATTERN } from "./regex.js";

// Bits of sha256 kept as the non-ASCII fallback id. 16 base64url chars =
// 96 bits; birthday-collision expectation lives at ~2^48 entries, so
// collisions are effectively impossible for any realistic workspace.
const NON_ASCII_HASH_LEN = 16;

// Max slug length used by both `slugify` (output cap) and `isValidSlug`
// (acceptance cap). 120 leaves plenty of room for filename slugs while
// staying well under filesystem path limits and URL-segment conventions.
// Bumped from 64 alongside the slug-rule unification (#732) so journal /
// todo / wiki / files can all share one rule without truncating their
// previously-longer inputs.
//
// Exported so callers that compose a base slug with their own suffix
// (e.g. `${base}-2` collision avoidance) can stay inside the same cap
// — necessary because a 120-char base + "-2" would otherwise produce a
// 122-char id that fails `isValidSlug`.
export const DEFAULT_MAX_LENGTH = 120;

// eslint-disable-next-line no-control-regex
const NON_ASCII_RE = /[^\x00-\x7F]/;

export function hasNonAscii(input: string): boolean {
  return NON_ASCII_RE.test(input);
}

// Deterministic short hash for inputs that can't be represented as an
// ASCII slug. base64url is URL-safe and denser than hex.
export function hashSlug(input: string, length: number = NON_ASCII_HASH_LEN): string {
  return createHash("sha256").update(input, "utf-8").digest("base64url").slice(0, length);
}

// Validates a slug: lowercase alphanumeric + hyphens, 1–DEFAULT_MAX_LENGTH
// chars, no leading/trailing hyphen, no consecutive hyphens. Previously
// duplicated in sources/paths.ts and skills/paths.ts.
export function isValidSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length === 0 || slug.length > DEFAULT_MAX_LENGTH) return false;
  // Pattern + ReDoS-safety rationale lives in `server/utils/regex.ts`.
  if (!SLUG_PATTERN.test(slug)) return false;
  if (slug.includes("--")) return false;
  return true;
}

export function slugify(title: string, defaultSlug = "page", maxLength = DEFAULT_MAX_LENGTH): string {
  const asciiSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength);

  if (!hasNonAscii(title)) return asciiSlug || defaultSlug;

  const hash = hashSlug(title.trim());
  // Preserve a meaningful ASCII prefix (e.g. "doing (進行中)" → "doing-<hash>")
  // only when at least 3 chars survived the sanitise step — a shorter
  // prefix wouldn't help readers distinguish entries.
  if (asciiSlug.length >= 3) {
    const prefixMax = Math.max(0, maxLength - hash.length - 1);
    return `${asciiSlug.slice(0, prefixMax)}-${hash}`;
  }
  return hash;
}

// Disambiguate `base` against `existingIds` by appending `-2`, `-3`, …
// until a free id is found. Truncates `base` (stripping any trailing
// hyphen so the join never produces `--`) so the composite stays
// within `DEFAULT_MAX_LENGTH` — required because a 120-char base + "-2"
// would otherwise produce a 122-char id that fails `isValidSlug`.
//
// Shared between server (`todosColumnsHandlers#uniqueId`) and the
// Playwright mock (`e2e/tests/todo-columns.spec.ts`) so the e2e
// dispatcher mirrors server behavior at the truncation boundary.
//
// Precondition: `base` must already be a canonical slug — typically
// the output of `slugify`. Concretely: lowercase ASCII alnum +
// hyphens, no leading/trailing hyphen, no `--`, length within
// `DEFAULT_MAX_LENGTH`. Inputs outside that grammar (e.g. uppercase,
// punctuation, leading hyphen) get NO defensive treatment — if they
// collide they will be disambiguated to an equally-invalid suffix
// form. The helper only special-cases empty/all-hyphen bases (where
// no valid disambiguation exists at all) and returns them
// unchanged so it never *fabricates* a `-2`-style invalid slug from
// nothing. Codex iter-4/5 #732.
export function disambiguateSlug(base: string, existingIds: ReadonlySet<string>): string {
  if (!hasNonHyphenChar(base)) return base;
  if (!existingIds.has(base)) return base;
  const compose = (suffix: number): string => {
    const tail = `-${suffix}`;
    const room = DEFAULT_MAX_LENGTH - tail.length;
    // Pick the cut: full base when it already fits, room-truncated
    // otherwise. Then strip any trailing hyphen at that cut so the
    // join never yields `--` (which `isValidSlug` rejects). Manual
    // loop instead of a regex — `sonarjs/slow-regex` flags `-+$`
    // even on this bounded input.
    const cut = base.length <= room ? base.length : room;
    let end = cut;
    while (end > 0 && base[end - 1] === "-") end--;
    return `${base.slice(0, end)}${tail}`;
  };
  let suffix = 2;
  while (existingIds.has(compose(suffix))) suffix++;
  return compose(suffix);
}

function hasNonHyphenChar(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== "-") return true;
  }
  return false;
}
