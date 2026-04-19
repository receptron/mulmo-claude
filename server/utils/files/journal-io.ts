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
import {
  summariesRoot,
  dailyPathFor,
  topicPathFor,
  TOPICS_DIR,
  INDEX_FILE,
  STATE_FILE,
  DAILY_DIR,
  ARCHIVE_DIR,
} from "../../workspace/journal/paths.js";

import fs from "node:fs";

const root = (r?: string) => r ?? workspacePath;

// ── State ───────────────────────────────────────────────────────

export function journalStateExists(r?: string): boolean {
  const p = path.join(summariesRoot(root(r)), STATE_FILE);
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJournalState<T>(fallback: T, r?: string): Promise<T> {
  const p = path.join(summariesRoot(root(r)), STATE_FILE);
  try {
    return JSON.parse(await fsp.readFile(p, "utf-8")) as T;
  } catch (err) {
    if (isEnoent(err)) return fallback;
    log.error("journal-io", "readJournalState failed", { error: String(err) });
    return fallback;
  }
}

export async function writeJournalState(
  state: unknown,
  r?: string,
): Promise<void> {
  const p = path.join(summariesRoot(root(r)), STATE_FILE);
  await writeFileAtomic(p, JSON.stringify(state, null, 2));
}

// ── Index ───────────────────────────────────────────────────────

export async function writeJournalIndex(md: string, r?: string): Promise<void> {
  const p = path.join(summariesRoot(root(r)), INDEX_FILE);
  await writeFileAtomic(p, md);
}

// ── Daily summaries ─────────────────────────────────────────────

export async function readDailySummary(
  date: string,
  r?: string,
): Promise<string | null> {
  try {
    return await fsp.readFile(dailyPathFor(root(r), date), "utf-8");
  } catch (err) {
    if (isEnoent(err)) return null;
    log.error("journal-io", `readDailySummary(${date}) failed`, {
      error: String(err),
    });
    return null;
  }
}

export async function writeDailySummary(
  date: string,
  content: string,
  r?: string,
): Promise<void> {
  await writeFileAtomic(dailyPathFor(root(r), date), content);
}

// ── Topics ──────────────────────────────────────────────────────

export async function readTopicFile(
  slug: string,
  r?: string,
): Promise<string | null> {
  try {
    return await fsp.readFile(topicPathFor(root(r), slug), "utf-8");
  } catch (err) {
    if (isEnoent(err)) return null;
    // EACCES/EPERM must propagate — swallowing them would cause
    // appendOrCreateTopic to clobber an unreadable file.
    throw err;
  }
}

export async function writeTopicFile(
  slug: string,
  content: string,
  r?: string,
): Promise<void> {
  await writeFileAtomic(topicPathFor(root(r), slug), content);
}

/** Append content to an existing topic, or create a new file. */
export async function appendOrCreateTopic(
  slug: string,
  content: string,
  r?: string,
): Promise<"created" | "updated"> {
  const existing = await readTopicFile(slug, r);
  if (existing === null) {
    await writeTopicFile(slug, content, r);
    return "created";
  }
  await writeTopicFile(slug, `${existing.trimEnd()}\n\n${content}\n`, r);
  return "updated";
}

/** List topic slugs (filenames without .md). */
export async function listTopicSlugs(r?: string): Promise<string[]> {
  const dir = path.join(summariesRoot(root(r)), TOPICS_DIR);
  try {
    const files = await fsp.readdir(dir);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch (err) {
    if (isEnoent(err)) return [];
    log.error("journal-io", "listTopicSlugs failed", { error: String(err) });
    return [];
  }
}

/** Read all topic files at once. Returns slug→content map. */
export async function readAllTopicFiles(
  r?: string,
): Promise<Map<string, string>> {
  const dir = path.join(summariesRoot(root(r)), TOPICS_DIR);
  const out = new Map<string, string>();
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    try {
      const content = await fsp.readFile(path.join(dir, f), "utf-8");
      out.set(f.replace(/\.md$/, ""), content);
    } catch {
      // skip unreadable files
    }
  }
  return out;
}

/** Move a topic to the archive directory. Returns false if the
 *  source doesn't exist or the move fails. */
export async function archiveTopic(slug: string, r?: string): Promise<boolean> {
  const src = topicPathFor(root(r), slug);
  const dst = path.join(
    summariesRoot(root(r)),
    ARCHIVE_DIR,
    TOPICS_DIR,
    `${slug}.md`,
  );
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

export async function listDailyFiles(r?: string): Promise<DailyFileEntry[]> {
  const dailyRoot = path.join(summariesRoot(root(r)), DAILY_DIR);
  const years = await safeReaddir(dailyRoot);
  const out: DailyFileEntry[] = [];
  for (const y of years.filter(isYearDir)) {
    const entries = await listDaysForYear(dailyRoot, y);
    out.push(...entries);
  }
  return out;
}

const YEAR_RE = /^\d{4}$/;
const MONTH_RE = /^\d{2}$/;
const isYearDir = (name: string) => YEAR_RE.test(name);
const isMonthDir = (name: string) => MONTH_RE.test(name);

async function listDaysForYear(
  dailyRoot: string,
  year: string,
): Promise<DailyFileEntry[]> {
  const months = await safeReaddir(path.join(dailyRoot, year));
  const out: DailyFileEntry[] = [];
  for (const m of months.filter(isMonthDir)) {
    const dayFiles = await safeReaddir(path.join(dailyRoot, year, m));
    for (const d of dayFiles) {
      if (d.endsWith(".md")) {
        out.push({ year, month: m, day: d.replace(/\.md$/, "") });
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

export async function countArchivedTopics(r?: string): Promise<number> {
  const dir = path.join(summariesRoot(root(r)), ARCHIVE_DIR, TOPICS_DIR);
  try {
    const files = await fsp.readdir(dir);
    return files.filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}
