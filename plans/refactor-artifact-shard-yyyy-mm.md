# Shard artifact dirs by `YYYY/MM` (#764)

## Goal

Stop unbounded growth of flat artifact directories. New artifacts land
in `<dir>/YYYY/MM/<original-filename>` (UTC date) so file explorer,
recent-changed, and the OS dirent table all stay tractable. Mirrors
the layout already used by `artifacts/news/`.

## Non-goals

- **Migration of existing flat files** — out of scope. Strategy A:
  legacy paths remain readable as-is (the resolvers don't care about
  depth); only new writes shift to YYYY/MM.
- Per-day partitioning (`YYYY/MM/DD`). Folded into a follow-up if
  one calendar month overwhelms a single bucket.
- Sharding `stories/`, `scenes/`, `scripts/`, `searches/`. Different
  flow (mulmo-script.ts uses user-named filenames; searches live
  under `conversations/`). Issue body's "9 dirs" was aspirational;
  the issue comment narrowed v1 to the five auto-accumulating dirs
  driven through `naming.ts` / `*-store.ts`.
- The `artifacts/html-scratch/` single-file scratch buffer.

## v1 scope (5 dirs)

| Dir | Write helper | Where it's called |
|---|---|---|
| `artifacts/images` | `saveImage` (image-store.ts) | image route, plugins route, canvas init |
| `artifacts/charts` | `buildArtifactPath` | chart route |
| `artifacts/html` (alias `htmls`) | `buildArtifactPath` | presentHtml route |
| `artifacts/spreadsheets` | `saveSpreadsheet` (spreadsheet-store.ts) | plugins route |
| `artifacts/documents` (alias `markdowns`) | `buildArtifactPathRandom` | markdown-store |

Existing `news/` is already sharded (`daily/YYYY/MM/DD.md` + `archive/<slug>/YYYY/MM.md`).

## Design

### Date-derived subpath

```ts
// server/utils/files/naming.ts
function yearMonthUtc(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}/${m}`;
}
```

UTC chosen over local time so a workspace synced across timezones
(or run in CI with UTC=local) lands files in the same bucket.

### `buildArtifactPath` / `buildArtifactPathRandom`

Inject `yearMonthUtc()` between `dir` and the filename:

```ts
return path.posix.join(dir, yearMonthUtc(), fname);
```

Pure path mutation — no IO. Callers (`chart.ts`, `presentHtml.ts`,
`markdown-store.ts`) already pipe the result into `writeFileAtomic`,
which already does `mkdir(path.dirname(filePath), { recursive: true })`,
so they pick up the new YYYY/MM subdir for free.

### `saveImage` / `saveSpreadsheet`

These don't go through `writeFileAtomic`, so they need an explicit
`mkdir(parent, { recursive: true })` before write. Otherwise structurally
identical:

```ts
export async function saveImage(base64Data: string): Promise<string> {
  await ensureImagesDir();
  const ym = yearMonthUtc();
  const parentAbs = path.join(IMAGES_DIR, ym);
  await mkdir(parentAbs, { recursive: true });
  const filename = `${shortId()}.png`;
  await writeFile(path.join(parentAbs, filename), Buffer.from(base64Data, "base64"));
  return path.posix.join(WORKSPACE_DIRS.images, ym, filename);
}
```

### Canvas image PUT API change

Current:

```
PUT /api/images/:filename
body: { imageData }
```

The route reconstructs the filesystem path from `:filename` only,
hard-coding flat layout (`imagePathFromFilename` joins
`WORKSPACE_DIRS.images + filename`). With the shard live, the file
actually lives at `images/2026/04/abc.png` and the lookup fails.

New:

```
PUT /api/images/update
body: { relativePath: "images/2026/04/abc.png", imageData: "..." }
```

- Server validates with `isImagePath(relativePath)` (already enforces
  the `images/` prefix and `.png` extension); `safeResolve` blocks
  traversal.
- Client (`canvas/View.vue`) already has `imagePath.value` (the
  full workspace-relative path returned at canvas creation), so it
  sends that verbatim instead of the popped basename.
- `imagePathFromFilename` is deleted.

Spreadsheet update flow: `overwriteSpreadsheet` already takes a
relative path argument, so no parallel API change needed.

## Backwards compatibility

- Existing flat paths still resolve. The `safeResolve` helpers in
  both stores use `resolveWithinRoot` which doesn't care about
  depth.
- `isImagePath` / `isSpreadsheetPath` use `startsWith(prefix)`, so
  nested paths still pass.
- Chat JSONL entries holding `images/abc.png` (legacy) keep working;
  the file is still on disk at that exact path.
- Wiki `![](images/abc.png)` rewrites are pure string operations,
  depth-agnostic.

## Tests

- `test/utils/files/test_naming.ts` — assert paths now contain
  `/YYYY/MM/` matching the current UTC date; check both helpers.
- `test/routes/test_canvasImageRoutes.ts` — remove the
  `imagePathFromFilename` gate test (function gone); add a test
  asserting the new body-based PUT flow accepts a valid sharded
  path and rejects a path outside `images/`.
- New unit test for `yearMonthUtc(now)` covering month padding
  (Jan → "01") and a trivial happy case.

## Rollout

Single PR. No feature flag (the change is forward-only — once a new
file is written it's at the new path; old files are immutable in
practice).

Verify post-merge: a fresh image generation lands at
`artifacts/images/2026/04/<id>.png`, canvas edits round-trip, file
explorer shows the YYYY/MM subdirs.

## Follow-up (out of scope)

- Migration script / CLI to relocate existing flat files (decision
  in the issue thread: not needed; flat residue is small and
  references are frozen).
- Sharding of stories/scenes/scripts/searches if they grow.
- Possible `YYYY/MM/DD` granularity if image generation scales up.
