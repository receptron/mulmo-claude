// Public entry point for the workspace journal. The agent route
// calls `maybeRunJournal()` from its `finally` block — fire-and-
// forget. This module decides whether a pass is actually due, holds
// an in-process lock so concurrent sessions don't double-run,
// orchestrates daily + optimization passes, and rebuilds _index.md.
//
// All failures are caught and logged here; nothing ever bubbles
// back to the request handler.

import fsp from "node:fs/promises";
import path from "node:path";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import {
  readState,
  writeState,
  isDailyDue,
  isOptimizationDue,
} from "./state.js";
import { runDailyPass } from "./dailyPass.js";
import { runOptimizationPass } from "./optimizationPass.js";
import {
  buildIndexMarkdown,
  type IndexTopicEntry,
  type IndexDailyEntry,
} from "./indexFile.js";
import {
  summariesRoot,
  DAILY_DIR,
  TOPICS_DIR,
  ARCHIVE_DIR,
  INDEX_FILE,
} from "./paths.js";
import {
  runClaudeCli,
  ClaudeCliNotFoundError,
  type Summarize,
} from "./archivist.js";
import { extractFirstH1 } from "../../../src/utils/markdown/extractFirstH1.js";
import { log } from "../../system/logger/index.js";

export { extractFirstH1 };

// Module-level lock. A boolean is enough for the single-process
// single-user MulmoClaude server; if two sessions finish at the
// same instant, the second call returns immediately.
let running = false;

// Once we hit ENOENT on the `claude` CLI we disable the journal
// for the rest of the server lifetime to avoid spamming warnings
// on every session-end. Reset on server restart.
let disabled = false;

// The agent route calls this as `maybeRunJournal().catch(...)`.
export interface MaybeRunJournalOptions {
  summarize?: Summarize;
  workspaceRoot?: string;
  activeSessionIds?: ReadonlySet<string>;
  // Skip the interval check and run both passes unconditionally.
  // Useful for debugging / CLI-driven manual runs — the feature's
  // disable flags (claude CLI missing, in-process lock) still apply.
  force?: boolean;
}

// Everything inside swallows its own errors so the promise never
// rejects in practice, but we still attach a catch at the call
// site defensively.
export async function maybeRunJournal(
  opts: MaybeRunJournalOptions = {},
): Promise<void> {
  if (disabled) return;
  if (running) return;
  running = true;
  try {
    await runJournalPass(opts);
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) {
      disabled = true;
      log.warn("journal", err.message);
      return;
    }
    log.warn("journal", "unexpected failure, continuing", {
      error: String(err),
    });
  } finally {
    running = false;
  }
}

async function runJournalPass(opts: MaybeRunJournalOptions): Promise<void> {
  const workspaceRoot = opts.workspaceRoot ?? defaultWorkspacePath;
  const summarize = opts.summarize ?? runClaudeCli;
  const activeSessionIds = opts.activeSessionIds ?? new Set<string>();

  const state = await readState(workspaceRoot);
  const now = Date.now();

  // `force: true` bypasses the interval gate entirely so debug /
  // startup flows can trigger a full pass even when nothing is
  // technically due.
  const daily = opts.force === true || isDailyDue(state, now);
  const optimize = opts.force === true || isOptimizationDue(state, now);
  if (!daily && !optimize) return;
  if (opts.force === true) {
    log.info("journal", "force-run: skipping interval gates");
  }

  let nextState = state;

  if (daily) {
    log.info("journal", "running daily pass");
    const { nextState: afterDaily, result } = await runDailyPass(nextState, {
      workspaceRoot,
      summarize,
      activeSessionIds,
    });
    // Only advance lastDailyRunAt when no days were skipped —
    // otherwise we'd wait a full interval before retrying a failed
    // day, letting transient archivist failures silently lose events.
    nextState = {
      ...afterDaily,
      ...(result.skipped.length === 0 && {
        lastDailyRunAt: new Date(now).toISOString(),
      }),
    };
    log.info("journal", "daily pass done", {
      sessions: result.sessionsIngested.length,
      days: result.daysTouched.length,
      topicsCreated: result.topicsCreated.length,
      topicsUpdated: result.topicsUpdated.length,
      daysSkipped: result.skipped.length,
    });
  }

  if (optimize) {
    log.info("journal", "running optimization pass");
    const { nextState: afterOpt, result } = await runOptimizationPass(
      nextState,
      { workspaceRoot, summarize },
    );
    // Same rule as daily: only advance the timestamp when the pass
    // actually ran to completion. A "skipped: too few topics" case
    // is still considered successful — there was simply nothing to
    // do — and we allow it to bump so we don't re-check on every
    // session-end.
    const optimizationSucceeded =
      !result.skipped || result.skippedReason === "fewer than 2 topics";
    nextState = {
      ...afterOpt,
      ...(optimizationSucceeded && {
        lastOptimizationRunAt: new Date(now).toISOString(),
      }),
    };
    if (result.skipped) {
      log.info("journal", "optimization pass skipped", {
        reason: result.skippedReason,
      });
    } else {
      log.info("journal", "optimization pass done", {
        merged: result.mergedSlugs.length,
        archived: result.archivedSlugs.length,
      });
    }
  }

  await rebuildIndex(workspaceRoot);
  await writeState(workspaceRoot, nextState);
}

// --- Index rebuild -------------------------------------------------

async function rebuildIndex(workspaceRoot: string): Promise<void> {
  const topics = await walkTopics(workspaceRoot);
  const days = await walkDailyFiles(workspaceRoot);
  const archivedCount = await countArchivedTopics(workspaceRoot);
  const md = buildIndexMarkdown({
    topics,
    days,
    archivedTopicCount: archivedCount,
    builtAtIso: new Date().toISOString(),
  });
  const p = path.join(summariesRoot(workspaceRoot), INDEX_FILE);
  await writeFileAtomic(p, md);
}

async function walkTopics(workspaceRoot: string): Promise<IndexTopicEntry[]> {
  const dir = path.join(summariesRoot(workspaceRoot), TOPICS_DIR);
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out: IndexTopicEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const slug = name.replace(/\.md$/, "");
    const full = path.join(dir, name);
    try {
      const [stat, content] = await Promise.all([
        fsp.stat(full),
        fsp.readFile(full, "utf-8"),
      ]);
      out.push({
        slug,
        title: extractFirstH1(content) ?? undefined,
        lastUpdatedIso: new Date(stat.mtimeMs).toISOString(),
      });
    } catch {
      out.push({ slug });
    }
  }
  return out;
}

// Returns the entries of `dir`, or [] if `dir` is missing / unreadable.
// Centralizes the "missing parent directory is fine" idiom that the
// daily-files walker leans on.
async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}

const YEAR_PATTERN = /^\d{4}$/;
const MONTH_PATTERN = /^\d{2}$/;
const DAY_FILE_PATTERN = /^(\d{2})\.md$/;

// Pure: returns the two-digit day if `name` matches `DD.md`, else null.
export function parseDailyFilename(name: string): string | null {
  const match = DAY_FILE_PATTERN.exec(name);
  return match ? (match[1] ?? null) : null;
}

async function walkDailyFiles(
  workspaceRoot: string,
): Promise<IndexDailyEntry[]> {
  const root = path.join(summariesRoot(workspaceRoot), DAILY_DIR);
  const out: IndexDailyEntry[] = [];
  const years = (await safeReaddir(root)).filter((y) => YEAR_PATTERN.test(y));
  for (const y of years) {
    const months = (await safeReaddir(path.join(root, y))).filter((m) =>
      MONTH_PATTERN.test(m),
    );
    for (const m of months) {
      const dayFiles = await safeReaddir(path.join(root, y, m));
      for (const d of dayFiles) {
        const day = parseDailyFilename(d);
        if (day) out.push({ date: `${y}-${m}-${day}` });
      }
    }
  }
  return out;
}

async function countArchivedTopics(workspaceRoot: string): Promise<number> {
  const dir = path.join(summariesRoot(workspaceRoot), ARCHIVE_DIR, TOPICS_DIR);
  try {
    const entries = await fsp.readdir(dir);
    return entries.filter((e) => e.endsWith(".md")).length;
  } catch {
    return 0;
  }
}
