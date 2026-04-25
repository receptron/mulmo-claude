// Top-level pipeline entry point.
//
// `runSourcesPipeline({ workspaceRoot, scheduleType, ... })`
// threads every phase in order:
//
//   1. Load sources from the registry
//   2. Read per-source state from `_state/<slug>.json`
//   3. Plan: filter by schedule + backoff
//   4. Fetch: per-source, parallel, failure-isolated
//   5. Dedup across sources (first occurrence wins)
//   6. Summarize via claude CLI (skipped for 0 items)
//   7. Write daily markdown + JSON block
//   8. Append every item to its per-source monthly archive
//   9. Persist updated per-source state back to disk
//
// Design follows #188 decisions: per-source try/catch (Q8),
// cross-source dedup only at summary step (Q3), local timezone
// (Q6), parallel across hosts (Q7 — enforced deeper by
// HostRateLimiter inside fetchPolite).
//
// Fully DI-threaded: `getFetcher`, `summarizeFn`, `now` are all
// parameters, and workspaceRoot is explicit. Tests can drive
// the whole pipeline end-to-end against a mkdtempSync workspace
// with stub fetchers and a fake summarize.

// Side-effect import: registers every production fetcher so
// `registryGetFetcher(kind)` below resolves. Without this the
// pipeline would run, report `no-fetcher` for every source, and
// write an empty daily file.
import "../fetchers/registerAll.js";

import { existsSync } from "fs";
import { listSources } from "../registry.js";
import { readManyStates, writeManyStates } from "../sourceState.js";
import { dailyNewsPath } from "../paths.js";
import { getFetcher as registryGetFetcher, type FetcherDeps, type SourceFetcher } from "../fetchers/index.js";
import { defaultSourceState } from "../types.js";
import type { FetcherKind, Source, SourceItem, SourceState, SourceSchedule } from "../types.js";
import { planEligibleSources } from "./plan.js";
import { runFetchPhase, computeNextState, type FetchOutcome } from "./fetch.js";
import { dedupAcrossSources, type DedupStats } from "./dedup.js";
import { makeDefaultSummarize, type SummarizeFn } from "./summarize.js";
import { writeDailyFile, appendItemsToArchives } from "./write.js";
import { runNotifyPhase } from "./notify.js";
import { discoverAndRegister } from "../arxivDiscovery.js";
import { log } from "../../../system/logger/index.js";
import { toLocalIsoDate } from "../../../utils/date.js";

export interface RunPipelineInput {
  workspaceRoot: string;
  scheduleType: SourceSchedule;
  // Shared across all fetchers in the run (rate limiter, robots
  // provider, fetch impl, timeout — assembled by the caller).
  fetcherDeps: FetcherDeps;
  // Pipeline-run clock. Production passes `() => Date.now()`.
  // Tests pass a fixed millis so isoDate / backoff math is
  // deterministic.
  nowMs: () => number;
  // Injection hooks.
  getFetcher?: (kind: FetcherKind) => SourceFetcher | null;
  summarizeFn?: SummarizeFn;
  // For test instrumentation; ignored in production.
  onProgress?: (phase: string) => void;
}

export interface RunPipelineResult {
  // Sources considered in this run.
  plannedCount: number;
  // Raw fetch outcomes (success / error / no-fetcher). In
  // original plan order.
  outcomes: FetchOutcome[];
  // Items emitted after cross-source dedup, ready for
  // summarization + archive append.
  items: SourceItem[];
  dedup: DedupStats;
  // Absolute path of the daily markdown file written.
  dailyPath: string;
  archiveWrittenPaths: string[];
  // Non-fatal errors from the archive append step.
  archiveErrors: string[];
  // Per-source post-run states, already persisted to disk.
  nextStates: SourceState[];
  // Local ISO date used for the daily header / filename.
  isoDate: string;
}

// Convert a wall-clock millis value to YYYY-MM-DD in LOCAL
// time, matching the #188 Q6 decision ("Local time, like the
// journal"). The journal's `toIsoDate` in paths.ts uses the
// Re-export for callers that imported from this module.
export { toLocalIsoDate } from "../../../utils/date.js";

// Convert a wall-clock millis value to the LOCAL year-month
// key (YYYY-MM) used as the archive fallback for items without
// a parseable publishedAt.
export function toLocalYearMonth(millis: number): string {
  const date = new Date(millis);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function runSourcesPipeline(input: RunPipelineInput): Promise<RunPipelineResult> {
  const { workspaceRoot, scheduleType, fetcherDeps, nowMs, getFetcher = registryGetFetcher, onProgress = () => {} } = input;

  const startMs = nowMs();
  const isoDate = toLocalIsoDate(startMs);
  const fallbackMonth = toLocalYearMonth(startMs);
  const summarizeFn = input.summarizeFn ?? makeDefaultSummarize(isoDate);

  log.info("pipeline", "run: start", { scheduleType, isoDate });

  // --- 0. Auto-discover arXiv sources from interests ------------------
  // Best-effort: a bad interests.json or FS error must not abort the
  // entire pipeline. The daily news fetch is more important than
  // auto-registering arXiv sources.
  onProgress("discover");
  try {
    await discoverAndRegister(workspaceRoot);
  } catch (err) {
    log.warn("pipeline", "arXiv auto-discovery failed (non-fatal)", {
      error: String(err),
    });
  }

  // --- 1. Load registry + state --------------------------------------
  onProgress("load");
  const allSources = await listSources(workspaceRoot);
  const statesBySlug = await readManyStates(
    workspaceRoot,
    allSources.map((source) => source.slug),
  );
  log.info("pipeline", "run: registry loaded", { sources: allSources.length });

  // --- 2. Plan ------------------------------------------------------
  onProgress("plan");
  const eligible = planEligibleSources({
    sources: allSources,
    statesBySlug,
    scheduleType,
    nowMs: startMs,
  });
  log.info("pipeline", "run: planned", { eligible: eligible.length, total: allSources.length });
  if (eligible.length === 0) {
    // Write an empty-day daily file so it's clear the pipeline
    // ran. Archive append is a no-op. State untouched.
    //
    // But: if a previous pass today already produced a non-empty
    // brief, don't clobber it. A same-day rerun with nothing due
    // (all sources still in backoff / on "weekly" schedule) would
    // otherwise wipe the morning's brief when re-triggered in the
    // afternoon.
    onProgress("write-empty");
    const existingPath = dailyNewsPath(workspaceRoot, isoDate);
    const dailyPath = existsSync(existingPath) ? existingPath : await writeDailyFile(workspaceRoot, isoDate, await summarizeFn([]), []);
    return {
      plannedCount: 0,
      outcomes: [],
      items: [],
      dedup: {
        uniqueCount: 0,
        duplicateCount: 0,
        duplicateSlugsById: new Map(),
      },
      dailyPath,
      archiveWrittenPaths: [],
      archiveErrors: [],
      nextStates: [],
      isoDate,
    };
  }

  // --- 3. Fetch -----------------------------------------------------
  onProgress("fetch");
  const { outcomes } = await runFetchPhase({
    sources: eligible,
    statesBySlug,
    deps: fetcherDeps,
    getFetcher,
  });
  const fetchSummary = summariseOutcomes(outcomes);
  log.info("pipeline", "run: fetched", fetchSummary);
  for (const failure of fetchSummary.failures) {
    // One warn per failed source so the slug is greppable. The
    // pipeline isolates errors per-source, but without this trace
    // a silently-failing fetcher disappears entirely.
    log.warn("pipeline", "run: fetcher failed", failure);
  }

  // --- 4. Dedup -----------------------------------------------------
  onProgress("dedup");
  const rawItems = flattenItems(outcomes);
  const dedup = dedupAcrossSources(rawItems);
  log.info("pipeline", "run: deduped", {
    raw: rawItems.length,
    unique: dedup.stats.uniqueCount,
    duplicates: dedup.stats.duplicateCount,
  });

  // --- 5. Notify (user interest matching) ----------------------------
  onProgress("notify");
  runNotifyPhase(dedup.items, workspaceRoot);

  // --- 6. Summarize + write ----------------------------------------
  onProgress("summarize");
  const markdown = await summarizeFn(dedup.items);

  onProgress("write"); // step 7
  const dailyPath = await writeDailyFile(workspaceRoot, isoDate, markdown, dedup.items);
  const archiveResult = await appendItemsToArchives(workspaceRoot, dedup.items, fallbackMonth);
  log.info("pipeline", "run: wrote", {
    items: dedup.items.length,
    dailyBytes: markdown.length,
    archiveFiles: archiveResult.writtenPaths.length,
    archiveErrors: archiveResult.errors.length,
  });

  // --- 8. Persist state ---------------------------------------------
  onProgress("persist");
  const nextStates = buildNextStates(eligible, statesBySlug, outcomes, nowMs());
  await writeManyStates(workspaceRoot, nextStates);

  onProgress("done");
  log.info("pipeline", "run: done", {
    plannedCount: eligible.length,
    items: dedup.items.length,
    elapsedMs: nowMs() - startMs,
  });
  return {
    plannedCount: eligible.length,
    outcomes,
    items: dedup.items,
    dedup: dedup.stats,
    dailyPath,
    archiveWrittenPaths: archiveResult.writtenPaths,
    archiveErrors: archiveResult.errors,
    nextStates,
    isoDate,
  };
}

// Cheap one-pass scan over outcomes producing the counters and the
// per-failure log payload the pipeline emits in the `fetched` log.
// Kept inline rather than reused elsewhere — only the pipeline
// summarises outcomes this way.
function summariseOutcomes(outcomes: readonly FetchOutcome[]): {
  total: number;
  success: number;
  noFetcher: number;
  errored: number;
  failures: Array<{ sourceSlug: string; kind: "no-fetcher" | "error"; error: string }>;
} {
  let success = 0;
  let noFetcher = 0;
  let errored = 0;
  const failures: Array<{ sourceSlug: string; kind: "no-fetcher" | "error"; error: string }> = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "success") {
      success++;
    } else if (outcome.kind === "no-fetcher") {
      noFetcher++;
      failures.push({ sourceSlug: outcome.sourceSlug, kind: "no-fetcher", error: outcome.error });
    } else {
      errored++;
      failures.push({ sourceSlug: outcome.sourceSlug, kind: "error", error: outcome.error });
    }
  }
  return { total: outcomes.length, success, noFetcher, errored, failures };
}

// Flatten successful-outcome items into a single list for
// dedup. Keeps the original source ordering (planned sort
// order) so dedup preserves deterministic precedence.
function flattenItems(outcomes: readonly FetchOutcome[]): SourceItem[] {
  const out: SourceItem[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind !== "success") continue;
    for (const item of outcome.items) out.push(item);
  }
  return out;
}

function buildNextStates(
  eligible: readonly Source[],
  statesBySlug: ReadonlyMap<string, SourceState>,
  outcomes: readonly FetchOutcome[],
  nowMs: number,
): SourceState[] {
  const outcomeBySlug = new Map<string, FetchOutcome>();
  for (const outcome of outcomes) {
    outcomeBySlug.set(outcome.sourceSlug, outcome);
  }
  const nextStates: SourceState[] = [];
  for (const source of eligible) {
    const prev = statesBySlug.get(source.slug) ?? defaultSourceState(source.slug);
    const outcome = outcomeBySlug.get(source.slug);
    if (!outcome) continue; // unreachable in practice; defensive
    nextStates.push(computeNextState(prev, outcome, nowMs));
  }
  return nextStates;
}
