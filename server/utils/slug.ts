import { createHash } from "crypto";

// Bits of sha256 kept as the non-ASCII fallback id. 16 base64url chars =
// 96 bits; birthday-collision expectation lives at ~2^48 entries, so
// collisions are effectively impossible for any realistic workspace.
const NON_ASCII_HASH_LEN = 16;

// eslint-disable-next-line no-control-regex
const NON_ASCII_RE = /[^\x00-\x7F]/;

export function hasNonAscii(input: string): boolean {
  return NON_ASCII_RE.test(input);
}

// Deterministic short hash for inputs that can't be represented as an
// ASCII slug. base64url is URL-safe and denser than hex.
export function hashSlug(
  input: string,
  length: number = NON_ASCII_HASH_LEN,
): string {
  return createHash("sha256")
    .update(input, "utf-8")
    .digest("base64url")
    .slice(0, length);
}

// Validates a slug: lowercase alphanumeric + hyphens, 1–64 chars,
// no leading/trailing hyphen, no consecutive hyphens. Previously
// duplicated in sources/paths.ts and skills/paths.ts.
export function isValidSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length === 0 || slug.length > 64) return false;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return false;
  if (slug.includes("--")) return false;
  return true;
}

export function slugify(
  title: string,
  defaultSlug = "page",
  maxLength = 60,
): string {
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
