// Unique-ID generation helpers. Three layers, one primitive
// (`crypto.randomUUID()`). See issue #723 for the design rationale.

import { randomUUID } from "crypto";

// 16-char hex slug length for `shortId()`. 64 bits of entropy —
// ~10^9 generations before a 1% collision rate — which is plenty
// for filename suffixes.
const SHORT_ID_HEX_LEN = 16;
// 6 hex chars for `makeId()`'s random tail — the timestamp already
// carries most of the uniqueness, so 24 bits of extra entropy is
// enough to disambiguate IDs generated in the same millisecond.
const MAKE_ID_HEX_LEN = 6;

/**
 * Full UUID v4 (36 chars, hyphenated).
 *
 * Use when the id is globally unique across the app lifetime and
 * round-trips through URLs, jsonl files, or external systems that
 * already expect the v4 shape (e.g. `chatSessionId`, scheduler
 * `task.id`, notification ids).
 */
export function makeUuid(): string {
  return randomUUID();
}

/**
 * 16-char hex slug derived from a UUID v4.
 *
 * Use when a short, opaque identifier is sufficient — e.g. image
 * and spreadsheet file-name suffixes. Not suitable for IDs that
 * round-trip through systems expecting UUID v4 formatting.
 */
export function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, SHORT_ID_HEX_LEN);
}

/**
 * Domain-prefixed, human-scannable ID.
 *
 * Format: `<prefix>_<epochMs>_<6 random hex chars>`. The prefix
 * makes IDs from different domains (todo, scheduler, column)
 * visually distinguishable in logs and JSON files.
 */
export function makeId(prefix: string): string {
  const randomHex = randomUUID().replace(/-/g, "").slice(0, MAKE_ID_HEX_LEN);
  return `${prefix}_${Date.now()}_${randomHex}`;
}
