# `@mulmoclaude/markdown-utils` — dedup markdown/image utils (host ↔ markdown-plugin)

## Why

jscpd's real duplication is NOT the bridges (Phase 3 barely moved it: 167→165 clones).
It's `packages/plugins/markdown-plugin/src/utils/` being a near-complete COPY of the host's
`src/utils/` (and one `server/utils/` file) — ~1000 duplicated lines, some **drifted**.

## Scope — clean set first (this PR)

New **browser-safe leaf** package `@mulmoclaude/markdown-utils` (v1.0.0). Move the files
that are byte-identical or comment-only-drift AND have no host-internal imports (canonical =
host `src/utils/` version, which carries the proper `eslint-disable` justifications):

`markdown/frontmatter`, `markdown/extractFirstH1`, `markdown/marpDetect`, `markdown/marpTheme`,
`markdown/marpCustomSize`, `markdown/taskList`, `image/cacheBust`, `image/htmlSrcAttrs`,
`dom/externalLink`, `files/filename` — **10 files**.

Deps: `js-yaml` (frontmatter, marpCustomSize); `vue` peerDep (cacheBust). Both consumers
already have vue.

Both the host (`src/`, `server/`) and markdown-plugin import from the package; all copies
deleted; ~43 import sites repointed (subpath exports, e.g. `@mulmoclaude/markdown-utils/markdown/frontmatter`).

## Deferred (separate PR) — intentional drift / host-coupling

- `image/resolve` — host imports `API_ROUTES`; plugin uses a settable `setFilesRawUrl()` to
  avoid the uphill import. Shared version must adopt the configurable pattern + host wires it.
- `image/rewriteMarkdownImageRefs` — depends on `resolve`.
- `markdown/mermaidRender` / `mermaidExtension` / `useMermaid` — plugin uses a distinct
  `mulmo-mermaid-plugin-` DOM id prefix to avoid host↔plugin id collisions. Parameterize
  `idPrefix`.
- `errors` — 31-line real drift.

## Not touched

`src/plugins/spreadsheet/engine/**` — user-designated untouchable; also added to the jscpd
`--ignore` in `.github/workflows/duplication-scan.yaml`.

## Verify

install → build (tier: markdown-utils before host/plugin) → typecheck → lint → tests →
jscpd (expect the moved-file clones gone). App-level `/verify` recommended before merge
(touches the markdown rendering path).
