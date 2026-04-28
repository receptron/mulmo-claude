// Architecture (#799) — agent route calls maybeRunJournal() fire-and-forget from its finally block. The daily pass
// (≥1h since last) walks chat/*.jsonl by mtime, buckets events by local date, writes daily summaries + topics, then
// extractAndAppendMemory appends durable user facts to memory.md. The optimization pass (≥7d) merges/archives topics.
// _index.md is rebuilt at the end of every successful pass. Roadmap: plans/audit-journal-subsystem.md.

import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import {
  writeJournalIndex,
  listTopicSlugs as listTopicSlugsIO,
  readTopicFile,
  listDailyFiles as listDailyFilesIO,
  countArchivedTopics as countArchivedIO,
} from "../../utils/files/journal-io.js";
import { readState, writeState, isDailyDue, isOptimizationDue } from "./state.js";
import { runDailyPass } from "./dailyPass.js";
import { runOptimizationPass } from "./optimizationPass.js";
import { buildIndexMarkdown, type IndexTopicEntry, type IndexDailyEntry } from "./indexFile.js";
import { runClaudeCli, ClaudeCliNotFoundError, type Summarize } from "./archivist-cli.js";
import { extractFirstH1 } from "../../../src/utils/markdown/extractFirstH1.js";
import { log } from "../../system/logger/index.js";

export { extractFirstH1 };

// Single-process server, so a boolean is enough; a second concurrent call simply returns.
let running = false;

// Latch off the journal for the rest of the process once the claude CLI is missing — avoids spamming on every session-end.
let disabled = false;

// Reset module-level flags between unit-test runs without re-importing the module.
export function __resetForTests(): void {
  running = false;
  disabled = false;
}

export interface MaybeRunJournalOptions {
  summarize?: Summarize;
  workspaceRoot?: string;
  activeSessionIds?: ReadonlySet<string>;
  // Bypass the interval gate; the disable flags (CLI missing, in-process lock) still apply.
  force?: boolean;
}

export async function maybeRunJournal(opts: MaybeRunJournalOptions = {}): Promise<void> {
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
    // Only bump lastDailyRunAt when no days were skipped — otherwise transient archivist failures silently lose events.
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
    const { nextState: afterOpt, result } = await runOptimizationPass(nextState, { workspaceRoot, summarize });
    // Same rule as daily, except "fewer than 2 topics" is still success — bump so we don't re-check every session-end.
    const optimizationSucceeded = !result.skipped || result.skippedReason === "fewer than 2 topics";
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

async function rebuildIndex(workspaceRoot: string): Promise<void> {
  const topics = await walkTopics(workspaceRoot);
  const dailyEntries = await listDailyFilesIO(workspaceRoot);
  const days: IndexDailyEntry[] = dailyEntries.map((entry) => ({
    date: `${entry.year}-${entry.month}-${entry.day}`,
  }));
  const archivedCount = await countArchivedIO(workspaceRoot);
  const markdown = buildIndexMarkdown({
    topics,
    days,
    archivedTopicCount: archivedCount,
    builtAtIso: new Date().toISOString(),
  });
  await writeJournalIndex(markdown, workspaceRoot);
}

async function walkTopics(workspaceRoot: string): Promise<IndexTopicEntry[]> {
  const slugs = await listTopicSlugsIO(workspaceRoot);
  const out: IndexTopicEntry[] = [];
  for (const slug of slugs) {
    const content = await readTopicFile(slug, workspaceRoot);
    out.push({
      slug,
      title: content ? (extractFirstH1(content) ?? undefined) : undefined,
    });
  }
  return out;
}

const DAY_FILE_PATTERN = /^(\d{2})\.md$/;

export function parseDailyFilename(name: string): string | null {
  const match = DAY_FILE_PATTERN.exec(name);
  return match ? (match[1] ?? null) : null;
}
