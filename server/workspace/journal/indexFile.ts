import { isoDateOnly } from "../../utils/date.js";

export interface IndexTopicEntry {
  slug: string;
  title?: string;
  lastUpdatedIso?: string;
}

export interface IndexDailyEntry {
  date: string; // YYYY-MM-DD local
}

export interface IndexInputs {
  topics: readonly IndexTopicEntry[];
  days: readonly IndexDailyEntry[];
  archivedTopicCount: number;
  builtAtIso: string;
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

export function renderTopicsSection(topics: readonly IndexTopicEntry[]): string[] {
  const lines: string[] = ["## Topics", ""];
  if (topics.length === 0) {
    lines.push("_No topics yet._");
    return lines;
  }
  // Newest-first; topics with no timestamp sort last, alphabetical among themselves for stability.
  const sorted = [...topics].sort(compareTopicsNewestFirst);
  for (const topicEntry of sorted) {
    lines.push(renderTopicRow(topicEntry));
  }
  return lines;
}

export function renderRecentDaysSection(days: readonly IndexDailyEntry[], maxRecent: number): string[] {
  const lines: string[] = ["## Recent days", ""];
  if (days.length === 0) {
    lines.push("_No daily entries yet._");
    return lines;
  }
  const sorted = [...days].sort((leftDay, rightDay) => {
    if (leftDay.date < rightDay.date) return 1;
    if (leftDay.date > rightDay.date) return -1;
    return 0;
  });
  const head = sorted.slice(0, maxRecent);
  for (const dayEntry of head) {
    lines.push(renderDailyRow(dayEntry));
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
  lines.push(`- [Archived topics](archive/topics/) — ${archivedTopicCount} ${noun}`);
  return lines;
}

// Invalid/missing ISO → -Infinity so they sort to the bottom.
function topicSortKey(entry: IndexTopicEntry): number {
  if (!entry.lastUpdatedIso) return -Infinity;
  const timestampMs = Date.parse(entry.lastUpdatedIso);
  return Number.isNaN(timestampMs) ? -Infinity : timestampMs;
}

function compareBySlug(leftEntry: IndexTopicEntry, rightEntry: IndexTopicEntry): number {
  if (leftEntry.slug < rightEntry.slug) return -1;
  if (leftEntry.slug > rightEntry.slug) return 1;
  return 0;
}

function compareTopicsNewestFirst(leftEntry: IndexTopicEntry, rightEntry: IndexTopicEntry): number {
  const leftKey = topicSortKey(leftEntry);
  const rightKey = topicSortKey(rightEntry);
  const leftIsValid = Number.isFinite(leftKey);
  const rightIsValid = Number.isFinite(rightKey);
  if (leftIsValid && rightIsValid && rightKey !== leftKey) return rightKey - leftKey;
  if (leftIsValid !== rightIsValid) return leftIsValid ? -1 : 1;
  return compareBySlug(leftEntry, rightEntry);
}

function renderTopicRow(topicEntry: IndexTopicEntry): string {
  const label = topicEntry.title && topicEntry.title.trim().length > 0 ? topicEntry.title : topicEntry.slug;
  const stamp = topicEntry.lastUpdatedIso ? ` — updated ${isoDateOnly(topicEntry.lastUpdatedIso)}` : "";
  return `- [${label}](topics/${topicEntry.slug}.md)${stamp}`;
}

function renderDailyRow(dayEntry: IndexDailyEntry): string {
  const [year, month, day] = dayEntry.date.split("-");
  return `- [${dayEntry.date}](daily/${year}/${month}/${day}.md)`;
}
