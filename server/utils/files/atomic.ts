// Atomic file-write primitives. rename(2) is atomic on POSIX; Node's
// Windows implementation falls back to copy+unlink which is still
// safer than truncating the target in place. Readers always see
// either the old file or the new file — never a half-written one.
//
// Moved from server/utils/file.ts (issue #366 Phase 1). The old
// file re-exports these for backwards compat.

import { mkdirSync, promises, renameSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { shortId } from "../id.js";

export interface WriteAtomicOptions {
  /** File mode for the final file (e.g. `0o600` for secrets). */
  mode?: number;
  /**
   * If true, append a short opaque id (`shortId()`) to the tmp
   * filename to avoid collisions at the OS level when multiple
   * writers target the same final path concurrently (e.g.
   * chat-index has this concern).
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
      await promises.rename(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Final attempt — let any error propagate.
  await promises.rename(fromPath, toPath);
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
      renameSync(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err)) throw err;
      sleepSync(delayMs);
    }
  }
  renameSync(fromPath, toPath);
}

// Binary writes (PNGs, etc.) come in as Uint8Array / Buffer. Strings
// stay text-encoded as utf-8. Forcing utf-8 on a Uint8Array would
// re-encode the bytes, which is exactly what we don't want for
// images. Pick the encoding option per content type.
function writeOptionsFor(content: string | Uint8Array, mode: number | undefined): { encoding?: "utf-8"; mode?: number } {
  return typeof content === "string" ? { encoding: "utf-8", mode } : { mode };
}

/**
 * Write `content` to `filePath` atomically. The parent directory is
 * created if missing. The tmp file is cleaned up on failure so a
 * crashed partial write can't wedge the next try.
 *
 * Accepts either text (utf-8 encoded) or binary content. Buffers
 * extend `Uint8Array`, so PNG / other binary blobs pass through
 * without conversion.
 */
export async function writeFileAtomic(filePath: string, content: string | Uint8Array, opts: WriteAtomicOptions = {}): Promise<void> {
  const tmp = opts.uniqueTmp ? `${filePath}.${shortId()}.tmp` : `${filePath}.tmp`;
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await promises.writeFile(tmp, content, writeOptionsFor(content, opts.mode));
    await renameWithWindowsRetry(tmp, filePath);
  } catch (err) {
    await promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Synchronous atomic write for callers that need it (e.g. server
 * startup, config saves that must complete before the next line).
 * Same contract as `writeFileAtomic` but blocking. Binary content
 * (Buffer / Uint8Array) is supported the same way.
 */
export function writeFileAtomicSync(filePath: string, content: string | Uint8Array, opts: WriteAtomicOptions = {}): void {
  const tmp = opts.uniqueTmp ? `${filePath}.${shortId()}.tmp` : `${filePath}.tmp`;
  mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    writeFileSync(tmp, content, writeOptionsFor(content, opts.mode));
    renameSyncWithWindowsRetry(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
