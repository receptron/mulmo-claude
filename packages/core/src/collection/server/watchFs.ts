// Shared `fs.watch` plumbing for the filesystem-backed stores.
//
// Every filesystem backend hits the same three quirks, so they are solved
// once here rather than in each store:
//
//   - `fs.watch` throws on a missing directory, so the watch has to be armed
//     lazily and re-armed rather than assumed;
//   - a filename arrives as `null` on some platforms (we then can't say which
//     record changed, only that something did);
//   - `filename` is typed `string` but can arrive as a Buffer, which has no
//     `startsWith` — calling it directly throws inside the callback and takes
//     the watcher down with it.
//
// Single-artifact backends (one CSV, one db file) additionally watch the
// PARENT directory rather than the file: an atomic replace swaps the inode,
// and a watch bound to the old one goes silently deaf.

import { realpathSync, watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { log } from "./host";

/** An atomic file replace (editor save, `mv` over the target) surfaces as
 *  2-3 events. Collapse them so one user action reports one change. */
const REPLACE_DEBOUNCE_MS = 300;

/** The path to hand `watch()`, with Windows 8.3 short names resolved away.
 *
 *  ReadDirectoryChangesW reports filenames against the LONG path, but a watch
 *  opened on a short path (`C:\Users\RUNNER~1\…` — what `os.tmpdir()` returns
 *  on GitHub's Windows runners) keeps the short form. libuv's
 *  `assert(!_wcsnicmp(filename, dir, dirlen))` in `src/win/fs-event.c` then
 *  aborts the PROCESS on the first event — a native assert, so neither
 *  `watcher.on("error")` nor a try/catch can contain it.
 *
 *  POSIX is deliberately left alone: `realpath` there also collapses symlinks
 *  (`/var` → `/private/var` on macOS), which we neither need nor want to
 *  change. A failure falls back to the original path — worst case we are no
 *  worse off than before. */
function watchablePath(dir: string): string {
  if (process.platform !== "win32") return dir;
  try {
    return realpathSync.native(dir);
  } catch {
    return dir;
  }
}

export interface FsWatchHandle {
  close: () => void;
}

/** Watch `dir`, reporting each accepted filename. `accept` decides what is
 *  noise; a null filename always passes (the platform didn't tell us which
 *  file, so the caller must assume the worst). */
export async function watchDirectory(
  dir: string,
  accept: (filename: string) => boolean,
  onHit: (filename: string | null) => void,
): Promise<FsWatchHandle | null> {
  try {
    await mkdir(dir, { recursive: true });
    const watcher: FSWatcher = watch(watchablePath(dir), { persistent: false }, (_eventType, rawFilename) => {
      // Defensive stringify: the callback's `string` typing is a lie on some
      // platforms, and a Buffer reaching `accept` would throw in here — which
      // kills the watcher, not just the event.
      const filename = rawFilename === null ? null : String(rawFilename);
      if (filename !== null && !accept(filename)) return;
      onHit(filename);
    });
    watcher.on("error", (err) => {
      log.warn("collections", "fs watch error", { dir, error: String(err) });
    });
    return { close: () => watcher.close() };
  } catch (err) {
    log.warn("collections", "fs watch start failed", { dir, error: String(err) });
    return null;
  }
}

/** Watch the single file `absPath` by watching its PARENT directory, so an
 *  atomic replace can't strand the watch on a dead inode. `alsoAccept`
 *  widens the filter beyond the exact basename (sqlite's `-wal`/`-journal`
 *  sidecars). Reports are debounced: one replace, one call. */
export async function watchSingleFile(
  absPath: string,
  alsoAccept: (basename: string, filename: string) => boolean,
  onChange: () => void,
): Promise<FsWatchHandle | null> {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, REPLACE_DEBOUNCE_MS);
    timer.unref?.();
  };
  const handle = await watchDirectory(dir, (filename) => filename === base || alsoAccept(base, filename), fire);
  if (!handle) return null;
  return {
    close: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      handle.close();
    },
  };
}

/** An `FsWatchHandle` as a bare unsubscribe — `null` straight through, so an
 *  unarmed watch stays distinguishable from an armed one. Lives here rather
 *  than beside the store contract so both `store.ts` and the backends it
 *  registers can reach it without importing each other. */
export function closerFor(handle: FsWatchHandle | null): (() => void) | null {
  return handle === null ? null : () => handle.close();
}
