// Backward scan over a session `.jsonl`. Takes the file CONTENT, never a
// path, so the read stays with the caller and the scan is testable without
// touching the filesystem.
import { isRecord } from "./types.js";

export type SessionJsonlEntry = Record<string, unknown>;

function parseEntryLine(line: string): SessionJsonlEntry | null {
  try {
    const entry: unknown = JSON.parse(line);
    return isRecord(entry) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Yields the object lines of a session jsonl, newest first.
 *
 * `JSON.parse` hands back `any`, so `.type` / `.id` reads at the call sites
 * were unchecked — a line of the wrong shape produced whatever it happened to
 * hold. Narrowing to a record is done here, once: a malformed line and a line
 * that parses to a non-object (number, string, array) are both skipped.
 *
 * A reverse index loop rather than `reverse().map()` because yielding lazily is
 * what lets `findLastSessionEntry` stop at the first hit instead of parsing the
 * whole transcript.
 */
function* sessionEntriesNewestFirst(content: string): Generator<SessionJsonlEntry> {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseEntryLine(lines[i]);
    if (entry !== null) yield entry;
  }
}

/** The first non-`undefined` `pick` walking from the newest entry backwards. */
export function findLastSessionEntry<T>(content: string, pick: (entry: SessionJsonlEntry) => T | undefined): T | undefined {
  for (const entry of sessionEntriesNewestFirst(content)) {
    const picked = pick(entry);
    if (picked !== undefined) return picked;
  }
  return undefined;
}

/** Every non-`undefined` `pick`, newest entry first. */
export function collectSessionEntriesNewestFirst<T>(content: string, pick: (entry: SessionJsonlEntry) => T | undefined): T[] {
  return [...sessionEntriesNewestFirst(content)].map(pick).filter((picked): picked is T => picked !== undefined);
}
