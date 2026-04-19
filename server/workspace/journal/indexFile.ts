// Pure builder for summaries/_index.md. Takes in-memory listings of
// the journal's current topic / daily files and returns the full
// markdown for the index. All filesystem walking happens in the
// caller; this function is deterministic and easy to snapshot-test.

import { isoDateOnly } from "../../utils/date.js";

export interface IndexTopicEntry {
  // Filesystem slug (matches topics/<slug>.md).
  slug: string;
  // Optional human-readable title extracted from the topic file's
  // first H1 heading. Falls back to `slug` if absent so the index
  // row always reads sensibly.
  title?: string;
  // ISO timestamp of the last write to the topic file. Rendered
  // for "stale topic" visibility.
  lastUpdatedIso?: string;
}

export interface IndexDailyEntry {
  // YYYY-MM-DD in local time. Matches the folder layout.
  date: string;
}

export interface IndexInputs {
  topics: readonly IndexTopicEntry[];
  days: readonly IndexDailyEntry[];
  archivedTopicCount: number;
  builtAtIso: string;
  // How many "Recent days" rows to list before collapsing the
  // remainder. The full listing still lives under daily/ on disk.
  maxRecentDays?: number;
}

export const DEFAULT_MAX_RECENT_DAYS = 14;

export function buildIndexMarkdown(input: IndexInputs): string {
  const maxRecent = input.maxRecentDays ?? DEFAULT_MAX_RECENT_DAYS;
  return [
    "# Workspace Journal",
    "",
    `*Last updated: ${input.builtAtIso}*`,
    "",
    ...renderTopicsSection(input.topics),
    "",
    ...renderRecentDaysSection(input.days, maxRecent),
    "",
    ...renderArchiveSection(input.archivedTopicCount),
    "",
  ].join("\n");
}

export function renderTopicsSection(
  topics: readonly IndexTopicEntry[],
): string[] {
  const lines: string[] = ["## Topics", ""];
  if (topics.length === 0) {
    lines.push("_No topics yet._");
    return lines;
  }
  // Newest-first by last update (topics with no timestamp sort
  // last, ordered alphabetically among themselves for stability).
  const sorted = [...topics].sort(compareTopicsNewestFirst);
  for (const t of sorted) {
    lines.push(renderTopicRow(t));
  }
  return lines;
}

export function renderRecentDaysSection(
  days: readonly IndexDailyEntry[],
  maxRecent: number,
): string[] {
  const lines: string[] = ["## Recent days", ""];
  if (days.length === 0) {
    lines.push("_No daily entries yet._");
    return lines;
  }
  // Newest-first by date string (YYYY-MM-DD sorts lexically).
  const sorted = [...days].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
  const head = sorted.slice(0, maxRecent);
  for (const d of head) {
    lines.push(renderDailyRow(d));
  }
  const rest = sorted.length - head.length;
  if (rest > 0) {
    lines.push("");
    lines.push(`_…and ${rest} earlier day${rest === 1 ? "" : "s"}._`);
  }
  return lines;
}

export function renderArchiveSection(archivedTopicCount: number): string[] {
  const lines: string[] = ["## Archive", ""];
  if (archivedTopicCount === 0) {
    lines.push("_No archived topics._");
    return lines;
  }
  const noun = archivedTopicCount === 1 ? "archived topic" : "archived topics";
  lines.push(
    `- [Archived topics](archive/topics/) — ${archivedTopicCount} ${noun}`,
  );
  return lines;
}

// Parse an ISO timestamp into a numeric sort key. Invalid or missing
// timestamps get -Infinity so they sort to the bottom (oldest).
function topicSortKey(entry: IndexTopicEntry): number {
  if (!entry.lastUpdatedIso) return -Infinity;
  const ms = Date.parse(entry.lastUpdatedIso);
  return Number.isNaN(ms) ? -Infinity : ms;
}

function compareBySlug(a: IndexTopicEntry, b: IndexTopicEntry): number {
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
}

function compareTopicsNewestFirst(
  a: IndexTopicEntry,
  b: IndexTopicEntry,
): number {
  const ak = topicSortKey(a);
  const bk = topicSortKey(b);
  // Both valid timestamps → compare numerically.
  // One or both invalid (-Infinity) → valid wins; if both invalid,
  // fall through to the slug tie-breaker.
  const aValid = Number.isFinite(ak);
  const bValid = Number.isFinite(bk);
  if (aValid && bValid && bk !== ak) return bk - ak;
  if (aValid !== bValid) return aValid ? -1 : 1;
  // Tie-break on slug for determinism.
  return compareBySlug(a, b);
}

function renderTopicRow(t: IndexTopicEntry): string {
  const label = t.title && t.title.trim().length > 0 ? t.title : t.slug;
  const stamp = t.lastUpdatedIso
    ? ` — updated ${isoDateOnly(t.lastUpdatedIso)}`
    : "";
  return `- [${label}](topics/${t.slug}.md)${stamp}`;
}

function renderDailyRow(d: IndexDailyEntry): string {
  const [year, month, day] = d.date.split("-");
  return `- [${d.date}](daily/${year}/${month}/${day}.md)`;
}
