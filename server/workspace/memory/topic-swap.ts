// Swap `conversations/memory/` ↔ `conversations/memory.next/`
// after the user has approved the staging diff (#1070 PR-A).
//
// Library only — invoked from a CLI helper or the agent (a tool
// surface for the agent will land later). The swap is intentionally
// NOT auto-run: the whole point of staging is to give the user a
// chance to inspect.
//
// CLEANUP 2026-07-01: see `topic-run.ts` — this file is part of
// the one-shot atomic → topic migration chain and goes when the
// chain goes.
//
// Swap mechanics:
//   memory/             →  memory/.atomic-backup-<ts>/
//   memory.next/        →  memory/
//
// The backup name carries a timestamp so re-runs (after a follow-up
// migration on a richer workspace) don't clobber prior backups.

import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { topicStagingPath } from "./topic-migrate.js";

export interface SwapResult {
  /** True when a swap actually happened. */
  swapped: boolean;
  /** Where the prior atomic layout was moved. Null if no prior data. */
  backupPath: string | null;
  /** Reason when `swapped: false`. */
  reason?: string;
}

export async function swapStagingIntoMemory(workspaceRoot: string): Promise<SwapResult> {
  const stagingPath = topicStagingPath(workspaceRoot);
  const memoryPath = path.join(workspaceRoot, "conversations", "memory");
  const stagingExists = await pathExists(stagingPath);
  if (!stagingExists) {
    return { swapped: false, backupPath: null, reason: "staging dir not found" };
  }

  let backupPath: string | null = null;
  if (await pathExists(memoryPath)) {
    backupPath = await pickBackupPath(memoryPath);
    try {
      await rename(memoryPath, backupPath);
    } catch (err) {
      log.error("memory", "topic-swap: backup rename failed", { from: memoryPath, to: backupPath, error: errorMessage(err) });
      return { swapped: false, backupPath: null, reason: "backup rename failed" };
    }
  }

  try {
    await rename(stagingPath, memoryPath);
  } catch (err) {
    log.error("memory", "topic-swap: staging rename failed", { from: stagingPath, to: memoryPath, error: errorMessage(err) });
    // Try to put the backup back so the workspace isn't left empty.
    if (backupPath) {
      try {
        await rename(backupPath, memoryPath);
      } catch (rollbackErr) {
        log.error("memory", "topic-swap: rollback failed; manual intervention needed", {
          backupPath,
          memoryPath,
          error: errorMessage(rollbackErr),
        });
      }
    }
    return { swapped: false, backupPath: null, reason: "staging rename failed" };
  }

  // Park the backup INSIDE the new memory dir so it travels with
  // the workspace. A flat sibling backup (`memory.atomic-backup`)
  // is also fine but clutters `conversations/`.
  if (backupPath) {
    const inside = path.join(memoryPath, ".atomic-backup");
    await mkdir(inside, { recursive: true });
    const finalLocation = path.join(inside, path.basename(backupPath));
    try {
      await rename(backupPath, finalLocation);
      backupPath = finalLocation;
    } catch (err) {
      log.warn("memory", "topic-swap: failed to park backup inside memory/, leaving at sibling location", {
        backupPath,
        error: errorMessage(err),
      });
    }
  }

  log.info("memory", "topic-swap: done", { backupPath, memoryPath });
  return { swapped: true, backupPath };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// Builds an unused backup path. We use a coarse timestamp suffix so
// re-runs sort chronologically and don't collide.
async function pickBackupPath(memoryPath: string): Promise<string> {
  const parent = path.dirname(memoryPath);
  const stamp = formatTimestamp(new Date());
  const base = `memory.atomic-backup-${stamp}`;
  let candidate = path.join(parent, base);
  let counter = 2;
  while (await pathExists(candidate)) {
    candidate = path.join(parent, `${base}-${counter}`);
    counter += 1;
  }
  return candidate;
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}`;
}
