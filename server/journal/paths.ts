// Pure path / slug helpers for the workspace journal. Nothing here
// touches the filesystem — every function is a straightforward
// string transformation so it can be exhaustively unit-tested.

import path from "node:path";

// Directory layout under workspace/summaries/ is an implementation
// detail of the journal module; keep it centralised here so tests
// and callers all agree on the structure.
export const SUMMARIES_DIR = "summaries";
export const STATE_FILE = "_state.json";
export const INDEX_FILE = "_index.md";
export const DAILY_DIR = "daily";
export const TOPICS_DIR = "topics";
export const ARCHIVE_DIR = "archive";

// Absolute path to the summaries root inside a workspace.
export function summariesRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, SUMMARIES_DIR);
}

// summaries/daily/YYYY/MM/DD.md for a given ISO-ish date ("YYYY-MM-DD").
// Throws if `isoDate` is not exactly YYYY-MM-DD — catches typos at
// the boundary instead of producing "undefined/undefined.md" paths
// downstream.
export function dailyPathFor(workspaceRoot: string, isoDate: string): string {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(
      `[journal] dailyPathFor: expected YYYY-MM-DD, got "${isoDate}"`,
    );
  }
  const [year, month, day] = isoDate.split("-");
  return path.join(
    summariesRoot(workspaceRoot),
    DAILY_DIR,
    year,
    month,
    `${day}.md`,
  );
}

// Strict YYYY-MM-DD check without a regex (sonarjs/slow-regex). We
// deliberately don't validate that the date is real (no "2026-02-31"
// rejection) — that's the LLM's / caller's job; we only make sure
// the string can be split into 3 numeric components so the
// downstream path math won't produce garbage.
function isValidIsoDate(s: string): boolean {
  if (s.length !== 10) return false;
  if (s[4] !== "-" || s[7] !== "-") return false;
  return (
    isNumeric(s.slice(0, 4)) &&
    isNumeric(s.slice(5, 7)) &&
    isNumeric(s.slice(8, 10))
  );
}

function isNumeric(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

// summaries/topics/<slug>.md
export function topicPathFor(workspaceRoot: string, slug: string): string {
  return path.join(summariesRoot(workspaceRoot), TOPICS_DIR, `${slug}.md`);
}

// summaries/archive/topics/<slug>.md — where the optimizer moves
// merged or stale topic files.
export function archivedTopicPathFor(
  workspaceRoot: string,
  slug: string,
): string {
  return path.join(
    summariesRoot(workspaceRoot),
    ARCHIVE_DIR,
    TOPICS_DIR,
    `${slug}.md`,
  );
}

// Convert a Date (or ms timestamp) to a YYYY-MM-DD string in LOCAL
// time. We intentionally use the local wall clock: this is a personal
// workspace, not a distributed system, and "what did I do on 2026-04-11"
// is a human-timezone question, not a UTC-offset question.
export function toIsoDate(input: Date | number): string {
  const d = typeof input === "number" ? new Date(input) : input;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Convert a free-form topic name into a filesystem-safe slug.
// Rules:
//   - Lowercase ASCII letters, digits, and hyphens only
//   - Whitespace and punctuation collapse to a single hyphen
//   - Non-ASCII characters (Japanese, emoji) are dropped; if the
//     result is empty we fall back to "topic" so we always yield a
//     valid filename (LLMs occasionally emit pure-Japanese topic
//     names; the markdown body still holds the original title for
//     display, this slug is only the filesystem key)
//   - Leading/trailing hyphens stripped
//   - Empty-string input yields "topic"
export function slugify(raw: string): string {
  const lowered = raw.toLowerCase();
  // Replace runs of non-ASCII-alnum with a single hyphen. Because
  // we use `+` on a character class, this single pass already
  // collapses runs — no second dedupe pass needed.
  const hyphenated = lowered.replace(/[^a-z0-9]+/g, "-");
  // Trim leading/trailing hyphens without a regex — sonarjs/slow-regex
  // flags `^-+` / `-+$` patterns even though these inputs are tiny.
  let start = 0;
  let end = hyphenated.length;
  while (start < end && hyphenated[start] === "-") start++;
  while (end > start && hyphenated[end - 1] === "-") end--;
  const trimmed = hyphenated.slice(start, end);
  return trimmed.length > 0 ? trimmed : "topic";
}
