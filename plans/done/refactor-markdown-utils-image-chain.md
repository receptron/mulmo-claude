# markdown-utils — image chain (resolve + rewriteMarkdownImageRefs)

Follow-up to #2277 (the deferred image chain). Moves the last big markdown/image
duplication into `@mulmoclaude/markdown-utils`, bumping it `1.0.0 → 1.1.0`.

## What

- **`image/resolve.ts`** — the plugin's version was the shareable one: it replaced the
  host's `API_ROUTES` import with a module-global `filesRawUrl` (default `/api/files/raw`)
  + `setFilesRawUrl()` to avoid an uphill import. That version moves into the package.
- **`image/rewriteMarkdownImageRefs.ts`** (237-line clone) — identical host/plugin; moves
  in. Its `./resolve` / `./htmlSrcAttrs` become package-internal relative imports again.
- Adds `marked` to the package deps (rewriteMarkdownImageRefs uses it).
- **Host init:** `src/composables/collections/uiHost.ts` (side-effect module loaded by
  `src/main.ts`) now calls `setFilesRawUrl(API_ROUTES.files.raw)`. The plugin default
  `/api/files/raw` already equals `API_ROUTES.files.raw`, so behavior is unchanged — the
  call just keeps `API_ROUTES` the single source of truth.
- 11 import sites (host + plugin + test) repointed; 4 copies deleted.

## Version — a clean minor, no consumer sweep

Because markdown-utils graduated to 1.0.0 in #2277, adding exports is a **minor** (1.1.0)
and `^1.0.0` already accepts it — **no consumer range sweep needed**. Only the launcher +
markdown-plugin ranges are bumped `^1.0.0 → ^1.1.0` for hygiene.

## jscpd (spreadsheet excluded)

2419 → **2163 duplicated lines (2.01% → 1.80%)** — the rewriteMarkdownImageRefs (237L) +
resolve clones gone.

## Verify

build:packages + full vite build EXIT 0 · typecheck EXIT 0 · lint 0 new · deps /
launcher-sync OK · `test_rewriteMarkdownImageRefs` 95/95 pass (image-resolution path).

## Release prerequisite

Publish `@mulmoclaude/markdown-utils@1.1.0` before the launcher / markdown-plugin are next
published.

## Still deferred (separate PR)

mermaid trio (`idPrefix` parameterization, app-critical → `/verify`); `errors` (a
`@mulmoclaude/core/utils` concern, not markdown-utils).
