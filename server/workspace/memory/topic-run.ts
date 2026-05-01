// One-shot topic-based migration entry point used by server startup
// (#1070 PR-B). Mirrors `runMemoryMigrationOnce` from #1029 PR-B
// but targets the topic-format restructure instead of the legacy
// memory.md flow.
//
// Idempotent: returns immediately when there is nothing to do —
// the workspace is already topic-format, there are no atomic
// entries to migrate, or the legacy `memory.md` is still in
// flight. When staging is already present from a prior crash mid-
// swap, this runner retries the swap rather than burning another
// LLM cluster call. Failures are logged and swallowed so the
// server can continue serving traffic.
//
// Concurrency: cluster runs in the background while the agent
// continues serving requests. Atomic-format reads / writes stay in
// effect right up until the swap completes; the next request after
// the swap sees the new topic layout.
//
// CLEANUP 2026-07-01: this is one-shot migration code for the
// atomic → topic transition (#1070). After every active workspace
// has been swapped to the topic format, this file plus
// `topic-migrate.ts`, `topic-cluster.ts`, `topic-swap.ts`, the CLI
// helper at `scripts/memory-swap-topic-staging.ts`, the
// `yarn memory:swap` script, and the migration call in
// `server/index.ts` can be deleted in one sweep. Topic-format
// reading / writing (`topic-types.ts`, `topic-io.ts`,
// `topic-detect.ts` — minus the atomic-format branch) stays.

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { runClaudeCli, ClaudeCliNotFoundError, type Summarize } from "../journal/archivist-cli.js";
import { loadAllMemoryEntries } from "./io.js";
import { makeLlmMemoryClusterer } from "./topic-cluster.js";
import { clusterAtomicIntoStaging, topicStagingPath } from "./topic-migrate.js";
import { swapStagingIntoMemory } from "./topic-swap.js";
import { hasTopicFormat } from "./topic-detect.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

export interface RunTopicMigrationDeps {
  /** Override the summarize callback (useful for tests). Defaults to
   *  the production `runClaudeCli` which spawns the Claude CLI. */
  summarize?: Summarize;
}

export async function runTopicMigrationOnce(workspaceRoot: string, deps: RunTopicMigrationDeps = {}): Promise<void> {
  if (hasTopicFormat(workspaceRoot)) {
    log.debug("memory", "topic-run: workspace already uses topic format, skipping");
    return;
  }
  const stagingPath = topicStagingPath(workspaceRoot);
  // If staging is left over from a prior run that crashed between
  // cluster and swap, just retry the swap. Re-clustering would burn
  // another LLM call and (because clusterAtomicIntoStaging wipes
  // staging up front) discard the prior cluster result.
  if (existsSync(stagingPath)) {
    log.info("memory", "topic-run: existing staging detected, retrying swap", { stagingPath });
    await runSwap(workspaceRoot);
    return;
  }
  // Don't trip over an in-progress legacy `memory.md` migration from
  // #1029 PR-B. We mirror the conditions under which
  // `runMemoryMigrationOnce` would actually run — legacy file
  // present, past the placeholder threshold, AND `.backup` absent.
  // The `.backup` check is load-bearing: when both `memory.md` and
  // `.backup` exist, the legacy runner refuses to re-process (the
  // backup signals "already done; user re-introduced the file"),
  // and without this clause the topic runner would defer
  // indefinitely waiting for a migration that's never going to
  // happen.
  const legacyPath = path.join(workspaceRoot, "conversations", "memory.md");
  if (existsSync(legacyPath)) {
    const stat = statSync(legacyPath);
    const backupPath = `${legacyPath}.backup`;
    if (stat.size >= 64 && !existsSync(backupPath)) {
      log.debug("memory", "topic-run: legacy memory.md still in flight, deferring", { legacyPath });
      return;
    }
  }
  const entries = await loadAllMemoryEntries(workspaceRoot);
  if (entries.length === 0) {
    log.debug("memory", "topic-run: no atomic entries to migrate, skipping");
    return;
  }
  const summarize = deps.summarize ?? runClaudeCli;
  const clusterer = makeLlmMemoryClusterer({ summarize });
  log.info("memory", "topic-run: starting", { entryCount: entries.length });
  try {
    const result = await clusterAtomicIntoStaging(workspaceRoot, clusterer);
    log.info("memory", "topic-run: staged", {
      stagingPath: result.stagingPath,
      topicCounts: result.topicCounts,
      bulletsLost: result.bulletsLost,
    });
    if (!result.noop) {
      await runSwap(workspaceRoot);
    }
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) {
      log.warn("memory", "topic-run: claude CLI not on PATH; topic restructure deferred");
      return;
    }
    log.error("memory", "topic-run: cluster threw", { error: errorMessage(err) });
  }
}

// Swap staging into the live memory dir. The atomic format is
// parked under `memory/.atomic-backup/<ts>/` so misclassified
// migrations can be rolled back by hand without losing data.
// Failures leave staging in place; the next server start hits the
// "existing staging detected" branch above and retries.
async function runSwap(workspaceRoot: string): Promise<void> {
  const result = await swapStagingIntoMemory(workspaceRoot);
  if (result.swapped) {
    log.info("memory", "topic-run: swap complete — workspace now uses topic format", {
      backupPath: result.backupPath,
    });
  } else {
    log.warn("memory", "topic-run: swap did not complete, leaving staging in place for retry", {
      reason: result.reason ?? "unknown",
    });
  }
}
