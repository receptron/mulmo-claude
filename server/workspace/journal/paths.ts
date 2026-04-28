import path from "node:path";
import { WORKSPACE_DIRS } from "../paths.js";
import { isValidIsoDate } from "../../utils/date.js";
import { slugify as slugifyCanonical } from "../../utils/slug.js";

export const SUMMARIES_DIR = WORKSPACE_DIRS.summaries;
export const STATE_FILE = "_state.json";
export const INDEX_FILE = "_index.md";
export const DAILY_DIR = "daily";
export const TOPICS_DIR = "topics";
export const ARCHIVE_DIR = "archive";

export function summariesRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, SUMMARIES_DIR);
}

export function dailyPathFor(workspaceRoot: string, isoDate: string): string {
  // Throw at the boundary so a typo doesn't produce "undefined/undefined.md".
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`[journal] dailyPathFor: expected YYYY-MM-DD, got "${isoDate}"`);
  }
  const [year, month, day] = isoDate.split("-");
  return path.join(summariesRoot(workspaceRoot), DAILY_DIR, year, month, `${day}.md`);
}

export function topicPathFor(workspaceRoot: string, slug: string): string {
  return path.join(summariesRoot(workspaceRoot), TOPICS_DIR, `${slug}.md`);
}

export function archivedTopicPathFor(workspaceRoot: string, slug: string): string {
  return path.join(summariesRoot(workspaceRoot), ARCHIVE_DIR, TOPICS_DIR, `${slug}.md`);
}

export { toLocalIsoDate as toIsoDate } from "../../utils/date.js";

// Falls through to slugifyCanonical with a journal-specific "topic" fallback.
// #732 retired the journal's own ASCII-only impl that collapsed every
// non-ASCII topic name onto a single overwriting "topic".
export function slugify(raw: string): string {
  return slugifyCanonical(raw, "topic");
}
