// Pure builder for summaries/_index.md. Takes in-memory listings of
// the journal's current topic / daily files and returns the full
// markdown for the index. All filesystem walking happens in the
// caller; this function is deterministic and easy to snapshot-test.

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
  const lines: string[] = [];
  lines.push("# Workspace Journal");
  lines.push("");
  lines.push(`*Last updated: ${input.builtAtIso}*`);
  lines.push("");

  lines.push("## Topics");
  lines.push("");
  if (input.topics.length === 0) {
    lines.push("_No topics yet._");
  } else {
    // Newest-first by last update (topics with no timestamp sort
    // last, ordered alphabetically among themselves for stability).
    const sorted = [...input.topics].sort(compareTopicsNewestFirst);
    for (const t of sorted) {
      lines.push(renderTopicRow(t));
    }
  }
  lines.push("");

  lines.push("## Recent days");
  lines.push("");
  if (input.days.length === 0) {
    lines.push("_No daily entries yet._");
  } else {
    // Newest-first by date string (YYYY-MM-DD sorts lexically).
    const sorted = [...input.days].sort((a, b) =>
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
  }
  lines.push("");

  lines.push("## Archive");
  lines.push("");
  if (input.archivedTopicCount === 0) {
    lines.push("_No archived topics._");
  } else {
    const noun =
      input.archivedTopicCount === 1 ? "archived topic" : "archived topics";
    lines.push(
      `- [Archived topics](archive/topics/) — ${input.archivedTopicCount} ${noun}`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

function compareTopicsNewestFirst(
  a: IndexTopicEntry,
  b: IndexTopicEntry,
): number {
  const at = a.lastUpdatedIso ? Date.parse(a.lastUpdatedIso) : NaN;
  const bt = b.lastUpdatedIso ? Date.parse(b.lastUpdatedIso) : NaN;
  const aValid = !Number.isNaN(at);
  const bValid = !Number.isNaN(bt);
  if (aValid && bValid) {
    // Tie-break on slug when timestamps are identical so the index
    // output is deterministic across repeated rebuilds. Without this,
    // equal-mtime topics fall back to input order, which depends on
    // readdir ordering and varies by filesystem.
    if (bt !== at) return bt - at;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  }
  if (aValid) return -1;
  if (bValid) return 1;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function renderTopicRow(t: IndexTopicEntry): string {
  const label = t.title && t.title.trim().length > 0 ? t.title : t.slug;
  const stamp = t.lastUpdatedIso
    ? ` — updated ${formatShortDate(t.lastUpdatedIso)}`
    : "";
  return `- [${label}](topics/${t.slug}.md)${stamp}`;
}

function renderDailyRow(d: IndexDailyEntry): string {
  const [year, month, day] = d.date.split("-");
  return `- [${d.date}](daily/${year}/${month}/${day}.md)`;
}

// Strip ISO time portion for compactness — "updated 2026-04-11" is
// plenty; the full timestamp is in _state.json if anyone needs it.
function formatShortDate(iso: string): string {
  return iso.slice(0, 10);
}
