// One-shot legacy-memory migration entry point used by server
// startup (#1029 PR-B). Idempotent: returns immediately when there
// is nothing to do (legacy file absent or already migrated).
//
// Concurrency: the agent may serve requests before this finishes.
// The brief race window is documented in
// `plans/feat-memory-storage-wire.md`.

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { runClaudeCli, ClaudeCliNotFoundError } from "../journal/archivist-cli.js";
import { makeLlmMemoryClassifier } from "./llm-classifier.js";
import { migrateLegacyMemory } from "./migrate.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

export async function runMemoryMigrationOnce(workspaceRoot: string): Promise<void> {
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
  const classifier = makeLlmMemoryClassifier({ summarize: runClaudeCli });
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
