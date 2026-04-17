// In-memory index of `wiki/pages/*.md` keyed by slug (= filename
// without the `.md` extension). Kept fresh via `pagesDir` mtime —
// adding, removing, or renaming a file under `pagesDir` advances
// the directory's mtime on every major filesystem we target
// (macOS APFS, Linux ext4, Windows NTFS), so one cheap `stat()`
// per request is enough to decide whether to rebuild.
//
// Eliminates the sync `readdirSync` + linear `find()` in the old
// `resolvePagePath` — see #201.

import { readDirSafeAsync, statSafeAsync } from "../../../utils/files/safe.js";

export interface PageIndex {
  mtimeMs: number;
  /** slug → filename (e.g. "sakura-internet" → "sakura-internet.md"). */
  slugs: Map<string, string>;
}

let cache: PageIndex | null = null;

/**
 * Get the page index for `pagesDir`. Returns a cached value as long
 * as the directory's mtime hasn't advanced; otherwise rebuilds.
 *
 * Safe to call concurrently — racing builds produce the same result.
 */
export async function getPageIndex(pagesDir: string): Promise<PageIndex> {
  const stat = await statSafeAsync(pagesDir);
  if (!stat) {
    // Dir doesn't exist yet (never ingested). Return empty but
    // don't cache a stale-forever value — the next call will
    // re-stat and pick up the dir once it lands.
    return { mtimeMs: 0, slugs: new Map() };
  }
  if (cache && cache.mtimeMs >= stat.mtimeMs) {
    return cache;
  }
  const entries = await readDirSafeAsync(pagesDir);
  const slugs = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.endsWith(".md")) continue;
    slugs.set(name.slice(0, -".md".length), name);
  }
  cache = { mtimeMs: stat.mtimeMs, slugs };
  return cache;
}

/** Test-only: drop the module-level cache. */
export function __resetPageIndexCache(): void {
  cache = null;
}
