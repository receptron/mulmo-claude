// Atomic file-write primitives. rename(2) is atomic on POSIX; Node's
// Windows implementation falls back to copy+unlink which is still
// safer than truncating the target in place. Readers always see
// either the old file or the new file — never a half-written one.
//
// Moved from server/utils/file.ts (issue #366 Phase 1). The old
// file re-exports these for backwards compat.

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export interface WriteAtomicOptions {
  /** File mode for the final file (e.g. `0o600` for secrets). */
  mode?: number;
  /**
   * If true, append a randomUUID to the tmp filename to avoid
   * collisions at the OS level when multiple writers target the same
   * final path concurrently (e.g. chat-index has this concern).
   * Default false — a single `${path}.tmp` is fine for most callers.
   */
  uniqueTmp?: boolean;
}

// ── Windows rename retry ────────────────────────────────────────
//
// On Windows, `rename` (MoveFileEx with MOVEFILE_REPLACE_EXISTING) can
// transiently fail with EPERM or EBUSY when antivirus / Search
// Indexer / Defender momentarily holds a handle on the tmp file or
// destination file. The failure window is tiny (usually <100ms) and
// the rename succeeds on a retry.
//
// On POSIX, `rename` is atomic and overwrites unconditionally. EPERM
// there means a real permission problem (read-only filesystem, sticky
// bit, cross-device link) — retrying wouldn't help and would only add
// latency before the inevitable throw. So the retry loop is gated to
// Windows.
const IS_WINDOWS = process.platform === "win32";
const RENAME_RETRY_DELAYS_MS = [30, 100, 300] as const;

function hasErrnoCode(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string";
}

function isTransientRenameError(err: unknown): boolean {
  if (!IS_WINDOWS || !hasErrnoCode(err)) return false;
  return err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES";
}

async function renameWithWindowsRetry(fromPath: string, toPath: string): Promise<void> {
  for (const delayMs of RENAME_RETRY_DELAYS_MS) {
    try {
      await fs.promises.rename(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Final attempt — let any error propagate.
  await fs.promises.rename(fromPath, toPath);
}

// Sync sleep that parks the thread instead of burning CPU. Only
// invoked on the transient-Windows-rename path, so the total worst-
// case block is the sum of RENAME_RETRY_DELAYS_MS (~430ms) and only
// triggers under AV/indexer contention.
const SYNC_SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(millis: number): void {
  Atomics.wait(SYNC_SLEEP_BUF, 0, 0, millis);
}

function renameSyncWithWindowsRetry(fromPath: string, toPath: string): void {
  for (const delayMs of RENAME_RETRY_DELAYS_MS) {
    try {
      fs.renameSync(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err)) throw err;
      sleepSync(delayMs);
    }
  }
  fs.renameSync(fromPath, toPath);
}

/**
 * Write `content` to `filePath` atomically. The parent directory is
 * created if missing. The tmp file is cleaned up on failure so a
 * crashed partial write can't wedge the next try.
 */
export async function writeFileAtomic(filePath: string, content: string, opts: WriteAtomicOptions = {}): Promise<void> {
  const tmp = opts.uniqueTmp ? `${filePath}.${randomUUID()}.tmp` : `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.writeFile(tmp, content, {
      encoding: "utf-8",
      mode: opts.mode,
    });
    await renameWithWindowsRetry(tmp, filePath);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Synchronous atomic write for callers that need it (e.g. server
 * startup, config saves that must complete before the next line).
 * Same contract as `writeFileAtomic` but blocking.
 */
export function writeFileAtomicSync(filePath: string, content: string, opts: WriteAtomicOptions = {}): void {
  const tmp = opts.uniqueTmp ? `${filePath}.${randomUUID()}.tmp` : `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tmp, content, { encoding: "utf-8", mode: opts.mode });
    renameSyncWithWindowsRetry(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
