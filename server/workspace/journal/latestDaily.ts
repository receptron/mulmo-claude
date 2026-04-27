// Find the most recent existing daily summary file under
// `conversations/summaries/daily/YYYY/MM/DD.md`. Used by the
// top-bar "today's journal" shortcut (#876): when today's summary
// hasn't been generated yet, the UI falls back to whatever the
// most recent existing day is.
//
// Walks deepest-first with backtrack: list YYYY → list MM → list
// DD.md. If a level is empty (e.g. `2026/05/` exists but has no
// daily files yet), drop back and try the next-largest entry at
// the parent level. Bounded I/O — at most O(years × months) readdir
// calls in pathological cases, 3 in the common case.

import path from "node:path";
import fsp from "node:fs/promises";
import { isEnoent } from "../../utils/files/safe.js";
import { summariesRoot, DAILY_DIR } from "./paths.js";

export interface LatestDailyResult {
  /** Workspace-relative path, e.g. "conversations/summaries/daily/2026/04/26.md" */
  path: string;
  /** ISO-ish date "YYYY-MM-DD" matching the file's location. */
  isoDate: string;
}

const YEAR_RE = /^\d{4}$/;
const MONTH_RE = /^\d{2}$/;
const DAY_FILE_RE = /^(\d{2})\.md$/;

async function listSorted(dir: string, pattern: RegExp): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  return entries
    .filter((name) => pattern.test(name))
    .sort()
    .reverse();
}

export async function findLatestDaily(workspaceRoot: string): Promise<LatestDailyResult | null> {
  const dailyRoot = path.join(summariesRoot(workspaceRoot), DAILY_DIR);
  const years = await listSorted(dailyRoot, YEAR_RE);
  for (const year of years) {
    const months = await listSorted(path.join(dailyRoot, year), MONTH_RE);
    for (const month of months) {
      const days = await listSorted(path.join(dailyRoot, year, month), DAY_FILE_RE);
      if (days.length === 0) continue;
      const dayFile = days[0];
      const dayMatch = DAY_FILE_RE.exec(dayFile);
      // Filter ensures the regex matches; this is a safety check.
      if (!dayMatch) continue;
      const day = dayMatch[1];
      const relPath = path.posix.join("conversations", "summaries", DAILY_DIR, year, month, dayFile);
      return { path: relPath, isoDate: `${year}-${month}-${day}` };
    }
  }
  return null;
}
