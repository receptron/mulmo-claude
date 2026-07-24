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
import { readState, writeState, isDailyDue, isOptimizationDue, type JournalState } from "./state.js";
import { runDailyPass } from "./dailyPass.js";
import { runOptimizationPass } from "./optimizationPass.js";
import { buildIndexMarkdown, type IndexTopicEntry, type IndexDailyEntry } from "./indexFile.js";
import { runClaudeCli, ClaudeCliNotFoundError, type Summarize, type JournalSummaryModel } from "./archivist-cli.js";
import { extractFirstH1 } from "@mulmoclaude/markdown-utils/markdown/extractFirstH1";
import { log } from "../../system/logger/index.js";
import { journalMode as resolveJournalMode, loadSettings, type JournalMode } from "../../system/config.js";

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
  // Injectable journal mode — defaults to `journalMode(loadSettings())`
  // when omitted. "off" short-circuits before any lock / state read;
  // "haiku" / "sonnet" pick the model the archivist CLI spawns. Tests
  // and the force-run switch inject this directly; production callers
  // (turn-end hook, scheduled task) let the resolver pick it up.
  mode?: JournalMode;
}

export async function maybeRunJournal(opts: MaybeRunJournalOptions = {}): Promise<void> {
  if (disabled) return;
  if (running) return;
  // Config-driven kill switch. Resolve at entry time so a settings edit
  // takes effect on the very next turn without a server restart.
  const mode = opts.mode ?? resolveJournalMode(loadSettings());
  if (mode === "off") return;
  running = true;
  try {
    await runJournalPass(opts, mode);
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

async function runJournalPass(opts: MaybeRunJournalOptions, model: JournalSummaryModel): Promise<void> {
  const workspaceRoot = opts.workspaceRoot ?? defaultWorkspacePath;
  // Pre-bind the model into the summarize callable so every layer
  // downstream (dailyPass / optimizationPass / memoryExtractor) picks
  // the user-selected model without threading the parameter through
  // half a dozen call sites.
  const rawSummarize = opts.summarize ?? runClaudeCli;
  const summarize: Summarize = (sys, user) => rawSummarize(sys, user, { model });
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
    nextState = await runDailyPhase(nextState, now, { workspaceRoot, summarize, activeSessionIds });
  }

  if (optimize) {
    nextState = await runOptimizationPhase(nextState, now, { workspaceRoot, summarize });
  }

  await rebuildIndex(workspaceRoot);
  await writeState(workspaceRoot, nextState);
}

interface DailyPhaseDeps {
  workspaceRoot: string;
  summarize: Summarize;
  activeSessionIds: ReadonlySet<string>;
}

async function runDailyPhase(state: JournalState, now: number, deps: DailyPhaseDeps): Promise<JournalState> {
  log.info("journal", "running daily pass");
  const { nextState: afterDaily, result } = await runDailyPass(state, deps);
  // Only bump lastDailyRunAt when no days were skipped — otherwise transient archivist failures silently lose events.
  const nextState = {
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
  return nextState;
}

interface OptimizationPhaseDeps {
  workspaceRoot: string;
  summarize: Summarize;
}

async function runOptimizationPhase(state: JournalState, now: number, deps: OptimizationPhaseDeps): Promise<JournalState> {
  log.info("journal", "running optimization pass");
  const { nextState: afterOpt, result } = await runOptimizationPass(state, deps);
  // Same rule as daily, except "fewer than 2 topics" is still success — bump so we don't re-check every session-end.
  const optimizationSucceeded = !result.skipped || result.skippedReason === "fewer than 2 topics";
  const nextState = {
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
  return nextState;
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
