// rename(2) is atomic on POSIX; Node's Windows fallback (copy+unlink) is still safer than truncating in place.
// Readers always see either the old file or the new — never a half-written one.
//
// Single source of truth for atomic file writes across the whole monorepo
// (host, core, plugins). Previously copy-pasted four times, so a Windows retry
// fix landed in only one (#2399, precedent #2222).

import { mkdirSync, promises, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface WriteAtomicOptions {
  mode?: number;
  /** Give the staging file a random suffix so concurrent writers to the same
   *  destination can't collide at the OS layer.
   *
   *  Defaults to `true`, and opting out is almost always wrong. A shared
   *  `${filePath}.tmp` means two writers of one file race: the second write
   *  overwrites the first's staging file, or one rename/unlink pulls it out
   *  from under the other, surfacing as `ENOENT … rename '<file>.tmp'`. That is
   *  not theoretical — it fired in production on session meta, where ten
   *  distinct callers (`setClaudeSessionId`, `backfillOrigin`,
   *  `incrementUserQueryCount`, …) all write the same `<sessionId>.json`
   *  (#2222).
   *
   *  Pass `false` only when you specifically need the staging path to be
   *  predictable (e.g. a single-writer token file, or a test that pre-creates
   *  it to force a write failure). */
  uniqueTmp?: boolean;
}

// Unique staging names are the safe default: the cost is a random suffix, the
// cost of the alternative is a lost update under concurrency (#2222).
const DEFAULT_UNIQUE_TMP = true;

function tmpPathFor(filePath: string, uniqueTmp: boolean | undefined): string {
  return (uniqueTmp ?? DEFAULT_UNIQUE_TMP) ? `${filePath}.${randomBytes(6).toString("hex")}.tmp` : `${filePath}.tmp`;
}

// On Windows, AV / Search Indexer / Defender briefly hold handles and rename trips EPERM/EBUSY/EACCES. Retry loop is
// gated to Windows because POSIX EPERM means a real perm problem (read-only fs, sticky, cross-device) — retrying
// just adds latency before the inevitable throw.
const IS_WINDOWS = process.platform === "win32";
const RENAME_RETRY_DELAYS_MS = [30, 100, 300] as const;

function hasErrnoCode(err: unknown): err is { code: string } {
  return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string";
}

// `isWindows` is a parameter (defaulting to the real platform) so the safety-critical decision is testable on any OS.
export function isTransientRenameError(err: unknown, isWindows: boolean = IS_WINDOWS): boolean {
  if (!isWindows || !hasErrnoCode(err)) return false;
  return err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES";
}

// Injectable so a test can drive the retry path (fail-then-succeed rename, no-op sleep, isWindows=true) on any OS.
export interface RenameRetryDeps {
  rename: (fromPath: string, toPath: string) => Promise<void>;
  sleep: (millis: number) => Promise<void>;
  isWindows: boolean;
}

const defaultRenameRetryDeps: RenameRetryDeps = {
  rename: (fromPath, toPath) => promises.rename(fromPath, toPath),
  sleep: (millis) => new Promise((resolve) => setTimeout(resolve, millis)),
  isWindows: IS_WINDOWS,
};

export async function renameWithWindowsRetry(fromPath: string, toPath: string, deps: RenameRetryDeps = defaultRenameRetryDeps): Promise<void> {
  for (const delayMs of RENAME_RETRY_DELAYS_MS) {
    try {
      await deps.rename(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err, deps.isWindows)) throw err;
      await deps.sleep(delayMs);
    }
  }
  // Final attempt — let any error propagate.
  await deps.rename(fromPath, toPath);
}

// Atomics.wait parks the thread instead of busy-spinning. Only on the Windows-rename retry path, total ≤ ~430ms.
const SYNC_SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(millis: number): void {
  Atomics.wait(SYNC_SLEEP_BUF, 0, 0, millis);
}

// Deliberate async/sync twin of RenameRetryDeps: `sleep` blocks the thread instead of returning a Promise.
export interface RenameRetryDepsSync {
  rename: (fromPath: string, toPath: string) => void;
  sleep: (millis: number) => void;
  isWindows: boolean;
}

const defaultRenameRetryDepsSync: RenameRetryDepsSync = {
  rename: (fromPath, toPath) => renameSync(fromPath, toPath),
  sleep: sleepSync,
  isWindows: IS_WINDOWS,
};

export function renameSyncWithWindowsRetry(fromPath: string, toPath: string, deps: RenameRetryDepsSync = defaultRenameRetryDepsSync): void {
  for (const delayMs of RENAME_RETRY_DELAYS_MS) {
    try {
      deps.rename(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err, deps.isWindows)) throw err;
      deps.sleep(delayMs);
    }
  }
  deps.rename(fromPath, toPath);
}

// Forcing utf-8 on a Uint8Array would re-encode the bytes — wrong for PNGs and other binary blobs.
function writeOptionsFor(content: string | Uint8Array, mode: number | undefined): { encoding?: "utf-8"; mode?: number } {
  return typeof content === "string" ? { encoding: "utf-8", mode } : { mode };
}

export async function writeFileAtomic(filePath: string, content: string | Uint8Array, opts: WriteAtomicOptions = {}): Promise<void> {
  const tmp = tmpPathFor(filePath, opts.uniqueTmp);
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
  const tmp = tmpPathFor(filePath, opts.uniqueTmp);
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
