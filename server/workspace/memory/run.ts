// One-shot legacy-memory migration entry point used by server
// startup (#1029 PR-B). Idempotent: returns immediately when there
// is nothing to do (legacy file absent or already migrated).
//
// Concurrency: the agent may serve requests before this finishes.
// The brief race window is documented in
// `plans/done/feat-memory-storage-wire.md`.
//
// CLEANUP 2026-07-01: this is one-shot migration code for the
// `memory.md` → atomic transition (#1029). After every active
// workspace has run through both `runMemoryMigrationOnce` and the
// follow-on `runTopicMigrationOnce`, this file plus the rest of
// the migration chain (`migrate.ts`, `llm-classifier.ts`, the
// atomic-aware branches in `prompt.ts`, the chain in
// `server/index.ts`) can be deleted in one sweep. Workspaces that
// have not migrated by then will need a manual conversion path —
// document the recovery before removing the code.

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { runClaudeCli, ClaudeCliNotFoundError, type Summarize } from "../journal/archivist-cli.js";
import { makeLlmMemoryClassifier } from "./llm-classifier.js";
import { migrateLegacyMemory } from "./migrate.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

export interface RunMigrationDeps {
  /** Override the summarize callback (useful for tests). Defaults to
   *  the production `runClaudeCli` which spawns the Claude CLI. */
  summarize?: Summarize;
}

export async function runMemoryMigrationOnce(workspaceRoot: string, deps: RunMigrationDeps = {}): Promise<void> {
  const legacyPath = path.join(workspaceRoot, "conversations", "memory.md");
  if (!existsSync(legacyPath)) {
    log.debug("memory", "migration: no legacy file, skipping");
    return;
  }
  // If the file is suspiciously empty (just the placeholder we used
  // to write at init), skip — the migration would yield zero entries
  // and the rename to `.backup` is pointless.
  const stat = statSync(legacyPath);
  if (stat.size < 64) {
    log.info("memory", "migration: legacy file is below the placeholder threshold, skipping");
    return;
  }
  // The rename to `.backup` is the final step of `migrateLegacyMemory`,
  // so its presence is the "migration completed" marker. A workspace
  // where both `memory.md` AND `memory.md.backup` exist means the
  // user re-introduced the legacy file after a previous successful
  // migration (probably by mistake or by extracting the backup).
  // Re-running here would re-classify the bullets and could clobber
  // typed entries the user has been editing in place; skip with a
  // clear log instead. The interrupted-migration retry case still
  // works because no `.backup` exists in that state — the rename
  // never ran.
  const backupPath = `${legacyPath}.backup`;
  if (existsSync(backupPath)) {
    log.info("memory", "migration: legacy file present but .backup also exists — refusing to re-run", {
      legacyPath,
      backupPath,
    });
    return;
  }
  const summarize = deps.summarize ?? runClaudeCli;
  const classifier = makeLlmMemoryClassifier({ summarize });
  log.info("memory", "migration: starting", { legacyPath });
  try {
    const result = await migrateLegacyMemory(workspaceRoot, classifier);
    log.info("memory", "migration: done", {
      noop: result.noop,
      written: result.written,
      skippedByClassifier: result.skippedByClassifier,
      writeErrors: result.writeErrors,
    });
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) {
      log.warn("memory", "migration: claude CLI not on PATH; legacy memory left in place");
      return;
    }
    log.error("memory", "migration: threw, legacy memory left in place", { error: errorMessage(err) });
  }
}
