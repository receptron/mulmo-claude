// rename(2) is atomic on POSIX; Node's Windows fallback (copy+unlink) is still safer than truncating in place.
// Readers always see either the old file or the new — never a half-written one.

import { mkdirSync, promises, renameSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { shortId } from "../id.js";

export interface WriteAtomicOptions {
  mode?: number;
  // Adds shortId() to the tmp filename so concurrent writers to the same path don't collide at the OS layer
  // (chat-index hits this).
  uniqueTmp?: boolean;
}

// On Windows, AV / Search Indexer / Defender briefly hold handles and rename trips EPERM/EBUSY/EACCES. Retry loop is
// gated to Windows because POSIX EPERM means a real perm problem (read-only fs, sticky, cross-device) — retrying
// just adds latency before the inevitable throw.
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

// Atomics.wait parks the thread instead of busy-spinning. Only on the Windows-rename retry path, total ≤ ~430ms.
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

// Forcing utf-8 on a Uint8Array would re-encode the bytes — wrong for PNGs and other binary blobs.
function writeOptionsFor(content: string | Uint8Array, mode: number | undefined): { encoding?: "utf-8"; mode?: number } {
  return typeof content === "string" ? { encoding: "utf-8", mode } : { mode };
}

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
