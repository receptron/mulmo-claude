# perf: wiki page index (#201)

## Motivation

`server/api/routes/wiki.ts` has two sync-I/O hotspots on the wiki read path:

1. **`resolvePagePath`** (`:104-122`) — every `GET /api/wiki?slug=foo` that doesn't hit an exact-match runs `fs.readdirSync(pagesDir)` + linear `find()` over the filenames. Called on every `manageWiki` tool invocation.
2. **`collectLintIssues`** (`:301-322`) — same `fs.readdirSync` + a sync `readFileOrEmpty` per page for the broken-link scan.

Both block the event loop. Fine at 5 pages, painful at 500+.

Per the expanded scope in [#201](https://github.com/receptron/mulmoclaude/issues/201), this PR resolves both in one shot by introducing an mtime-validated in-memory index over `wiki/pages/`.

## Design

### `server/api/routes/wiki/pageIndex.ts` (new)

Module-level cache. Key insight: `pagesDir` mtime advances whenever a file is added / removed / renamed inside it (on macOS, Linux, and Windows ext/NTFS), so one `fs.promises.stat` call per request is enough to decide cache freshness.

```ts
interface PageIndex {
  mtimeMs: number;
  // slug (filename sans `.md`) → filename
  slugs: Map<string, string>;
}

let cache: PageIndex | null = null;

export async function getPageIndex(pagesDir: string): Promise<PageIndex> {
  const stat = await fsp.stat(pagesDir).catch(() => null);
  if (!stat) {
    cache = { mtimeMs: 0, slugs: new Map() };
    return cache;
  }
  if (cache && cache.mtimeMs >= stat.mtimeMs) return cache;
  // (Re)build.
  const entries = await fsp.readdir(pagesDir);
  const slugs = new Map<string, string>();
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    slugs.set(name.slice(0, -".md".length), name);
  }
  cache = { mtimeMs: stat.mtimeMs, slugs };
  return cache;
}

// Test-only reset hook.
export function __resetPageIndexCache(): void { cache = null; }
```

stat on a cache-hit is ~μs; readdir only runs on dir-change.

**Concurrency note**: multiple concurrent calls on a stale cache all trigger a rebuild. Harmless — worst case is N×readdir, result identical. Not worth a Promise dedupe for this cost.

### `resolvePagePath` (rewrite async)

```ts
async function resolvePagePath(pageName: string): Promise<string | null> {
  const slug = wikiSlugify(pageName);
  const { slugs } = await getPageIndex(pagesDir());
  if (slugs.size === 0) return null;
  const exact = slugs.get(slug);
  if (exact) return path.join(pagesDir(), exact);
  // Fuzzy: same `includes` semantics as the old sync path.
  for (const [key, file] of slugs) {
    if (slug.includes(key) || key.includes(slug)) {
      return path.join(pagesDir(), file);
    }
  }
  return null;
}
```

### `collectLintIssues` (async + parallel)

- Get slugs from the index → replaces the `readdirSync`.
- Parallelise the broken-link scan:

```ts
const contents = await Promise.all(
  pageFiles.map((f) => fsp.readFile(path.join(dir, f), "utf-8").catch(() => "")),
);
for (let i = 0; i < pageFiles.length; i++) {
  issues.push(...findBrokenLinksInPage(pageFiles[i], contents[i], fileSlugs));
}
```

Both `index.md` reads keep their existing sync calls — cold path, not worth touching.

### Route handlers

`router.get("/wiki")`, `buildPageResponse`, `buildLintReportResponse` all become async. No behavioural change visible to the client.

## Tests

`test/routes/test_wikiPageIndex.ts` (new):
- Fresh dir → builds from disk
- Cache hit on same mtime
- Dir mtime bumps → rebuilds (hand-touched fixture)
- Non-md files ignored
- Missing dir → returns empty map
- `__resetPageIndexCache` works

Extend `test/routes/test_wikiRoute.ts` (or a new file if the existing one is pure-helper-only):
- `resolvePagePath` exact / fuzzy / miss — against a tmp dir fixture, with cache reset per test
- `collectLintIssues` orphan / missing / broken-link cases (parity with current behaviour)

## Non-goals

- Caching `wiki/index.md` itself (cold path, trivial file, benefit negligible)
- `fs.watch` or any subscription model (mtime poll is enough)
- Extending the index to wiki/sources/ or wiki/log.md (out of scope, not on a hot path)

## Rollout

1. Branch `perf/wiki-page-index-201` ✅
2. Plan (this file) ✅
3. Implement `pageIndex.ts` + unit tests
4. Refactor wiki.ts to async + use index
5. Update route-level tests
6. Quality gates (lint / typecheck / build / test / test:e2e)
7. PR + close #201 via the formal `Closes` link
