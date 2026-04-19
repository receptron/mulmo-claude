// Cursor logic for `GET /api/sessions?since=<cursor>` (issue #205).
//
// Kept separate from `sessions.ts` so the pure logic can be unit
// tested without an Express harness.
//
// The cursor is deliberately opaque to the client: today it encodes
// the max "change timestamp" (ms since epoch) as `"v1:<ms>"`, where a
// session's change timestamp is `max(jsonlMtimeMs, indexedAtMs)`. We
// prefix with `v1:` so a future encoding change (e.g. adding a
// deletion generation counter for approach A when deletion lands)
// can bump the prefix without clients caring — they always echo back
// whatever the server handed them.

const CURSOR_PREFIX = "v1:";

/**
 * Encode a change timestamp (ms) as an opaque cursor string.
 *
 * `changeMs <= 0` is allowed and yields `"v1:0"` — that's the
 * "beginning of time" cursor a client will never hold but which we
 * fall back to when an incoming cursor is malformed.
 */
export function encodeCursor(changeMs: number): string {
  const ms =
    Number.isFinite(changeMs) && changeMs > 0 ? Math.floor(changeMs) : 0;
  return `${CURSOR_PREFIX}${ms}`;
}

/**
 * Parse an incoming `?since=` cursor back to the ms timestamp it
 * encodes. Anything the client sends that we don't recognise — old
 * format, truncated, typo, empty — returns 0 so the client gets a
 * full resend instead of a broken sidebar. This is intentionally
 * forgiving; the failure mode is "downloads slightly more than
 * needed once" which is the behaviour clients had pre-#205 anyway.
 */
export function parseCursor(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  if (!raw.startsWith(CURSOR_PREFIX)) return 0;
  const n = Number(raw.slice(CURSOR_PREFIX.length));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Compute the per-session "change timestamp" in ms — the later of
 * the jsonl mtime (new user/assistant turn) and the chat-index
 * `indexedAt` (AI-generated title / summary updated in the
 * background and doesn't touch the jsonl). Missing / malformed
 * `indexedAt` falls back to the mtime alone.
 */
export function sessionChangeMs(
  jsonlMtimeMs: number,
  indexedAtIso: string | undefined,
): number {
  const indexedAtMs =
    indexedAtIso !== undefined ? new Date(indexedAtIso).getTime() : NaN;
  const safeIndexed = Number.isFinite(indexedAtMs) ? indexedAtMs : 0;
  return Math.max(jsonlMtimeMs, safeIndexed);
}
