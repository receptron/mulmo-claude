// Domain I/O: workspace journal (summaries)
//   conversations/summaries/_state.json        — journal state
//   conversations/summaries/_index.md           — browseable index
//   conversations/summaries/daily/YYYY/MM/DD.md — daily summaries
//   conversations/summaries/topics/<slug>.md    — topic files
//   conversations/summaries/archive/topics/     — archived topics
//
// All functions take optional `root` for test DI.
// Path helpers (summariesRoot, dailyPathFor, topicPathFor) live in
// journal/paths.ts — this module wraps them with I/O.

import path from "node:path";
import fsp from "node:fs/promises";
import { workspacePath } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import { isEnoent } from "./safe.js";
import { log } from "../../system/logger/index.js";
import { summariesRoot, dailyPathFor, topicPathFor, TOPICS_DIR, INDEX_FILE, STATE_FILE, DAILY_DIR, ARCHIVE_DIR } from "../../workspace/journal/paths.js";

import fs from "node:fs";

const root = (rootOverride?: string) => rootOverride ?? workspacePath;

// ── State ───────────────────────────────────────────────────────

export function journalStateExists(rootOverride?: string): boolean {
  const filePath = path.join(summariesRoot(root(rootOverride)), STATE_FILE);
  try {
    fs.statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJournalState<T>(fallback: T, rootOverride?: string): Promise<T> {
  const filePath = path.join(summariesRoot(root(rootOverride)), STATE_FILE);
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf-8")) as T;
  } catch (err) {
    if (isEnoent(err)) return fallback;
    log.error("journal-io", "readJournalState failed", { error: String(err) });
    return fallback;
  }
}

export async function writeJournalState(state: unknown, rootOverride?: string): Promise<void> {
  const filePath = path.join(summariesRoot(root(rootOverride)), STATE_FILE);
  await writeFileAtomic(filePath, JSON.stringify(state, null, 2));
}

// ── Index ───────────────────────────────────────────────────────

export async function writeJournalIndex(markdown: string, rootOverride?: string): Promise<void> {
  const filePath = path.join(summariesRoot(root(rootOverride)), INDEX_FILE);
  await writeFileAtomic(filePath, markdown);
}

// ── Daily summaries ─────────────────────────────────────────────

export async function readDailySummary(date: string, rootOverride?: string): Promise<string | null> {
  try {
    return await fsp.readFile(dailyPathFor(root(rootOverride), date), "utf-8");
  } catch (err) {
    if (isEnoent(err)) return null;
    log.error("journal-io", `readDailySummary(${date}) failed`, {
      error: String(err),
    });
    return null;
  }
}

export async function writeDailySummary(date: string, content: string, rootOverride?: string): Promise<void> {
  await writeFileAtomic(dailyPathFor(root(rootOverride), date), content);
}

// ── Topics ──────────────────────────────────────────────────────

export async function readTopicFile(slug: string, rootOverride?: string): Promise<string | null> {
  try {
    return await fsp.readFile(topicPathFor(root(rootOverride), slug), "utf-8");
  } catch (err) {
    if (isEnoent(err)) return null;
    // EACCES/EPERM must propagate — swallowing them would cause
    // appendOrCreateTopic to clobber an unreadable file.
    throw err;
  }
}

export async function writeTopicFile(slug: string, content: string, rootOverride?: string): Promise<void> {
  await writeFileAtomic(topicPathFor(root(rootOverride), slug), content);
}

/** Append content to an existing topic, or create a new file. */
export async function appendOrCreateTopic(slug: string, content: string, rootOverride?: string): Promise<"created" | "updated"> {
  const existing = await readTopicFile(slug, rootOverride);
  if (existing === null) {
    await writeTopicFile(slug, content, rootOverride);
    return "created";
  }
  await writeTopicFile(slug, `${existing.trimEnd()}\n\n${content}\n`, rootOverride);
  return "updated";
}

/** List topic slugs (filenames without .md). */
export async function listTopicSlugs(rootOverride?: string): Promise<string[]> {
  const dir = path.join(summariesRoot(root(rootOverride)), TOPICS_DIR);
  try {
    const files = await fsp.readdir(dir);
    return files.filter((file) => file.endsWith(".md")).map((file) => file.replace(/\.md$/, ""));
  } catch (err) {
    if (isEnoent(err)) return [];
    log.error("journal-io", "listTopicSlugs failed", { error: String(err) });
    return [];
  }
}

/** Read all topic files at once. Returns slug→content map. */
export async function readAllTopicFiles(rootOverride?: string): Promise<Map<string, string>> {
  const dir = path.join(summariesRoot(root(rootOverride)), TOPICS_DIR);
  const out = new Map<string, string>();
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return out;
  }
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    try {
      const content = await fsp.readFile(path.join(dir, file), "utf-8");
      out.set(file.replace(/\.md$/, ""), content);
    } catch {
      // skip unreadable files
    }
  }
  return out;
}

/** Move a topic to the archive directory. Returns false if the
 *  source doesn't exist or the move fails. */
export async function archiveTopic(slug: string, rootOverride?: string): Promise<boolean> {
  const src = topicPathFor(root(rootOverride), slug);
  const dst = path.join(summariesRoot(root(rootOverride)), ARCHIVE_DIR, TOPICS_DIR, `${slug}.md`);
  try {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.rename(src, dst);
    return true;
  } catch (err) {
    log.warn("journal-io", `archiveTopic(${slug}) failed`, {
      error: String(err),
    });
    return false;
  }
}

// ── Daily file listing ──────────────────────────────────────────

export interface DailyFileEntry {
  year: string;
  month: string;
  day: string;
}

export async function listDailyFiles(rootOverride?: string): Promise<DailyFileEntry[]> {
  const dailyRoot = path.join(summariesRoot(root(rootOverride)), DAILY_DIR);
  const years = await safeReaddir(dailyRoot);
  const out: DailyFileEntry[] = [];
  for (const year of years.filter(isYearDir)) {
    const entries = await listDaysForYear(dailyRoot, year);
    out.push(...entries);
  }
  return out;
}

const YEAR_RE = /^\d{4}$/;
const MONTH_RE = /^\d{2}$/;
const isYearDir = (name: string) => YEAR_RE.test(name);
const isMonthDir = (name: string) => MONTH_RE.test(name);

async function listDaysForYear(dailyRoot: string, year: string): Promise<DailyFileEntry[]> {
  const months = await safeReaddir(path.join(dailyRoot, year));
  const out: DailyFileEntry[] = [];
  for (const month of months.filter(isMonthDir)) {
    const dayFiles = await safeReaddir(path.join(dailyRoot, year, month));
    for (const dayFile of dayFiles) {
      if (dayFile.endsWith(".md")) {
        out.push({ year, month, day: dayFile.replace(/\.md$/, "") });
      }
    }
  }
  return out;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}

// ── Archived topic count ────────────────────────────────────────

export async function countArchivedTopics(rootOverride?: string): Promise<number> {
  const dir = path.join(summariesRoot(root(rootOverride)), ARCHIVE_DIR, TOPICS_DIR);
  try {
    const files = await fsp.readdir(dir);
    return files.filter((file) => file.endsWith(".md")).length;
  } catch {
    return 0;
  }
}
