# refactor(build): extract shared plugin `vite.config.ts` boilerplate — #2409

## Problem

Plugin `vite.config.ts` boilerplate is copy-pasted across 10+ workspaces
(jscpd flagged 12 near-identical pairs). The shared build policy — lib mode,
dual ESM+CJS `fileName`, `exports: "named"`, the `style.[ext]` CSS asset name,
`cssCodeSplit: false`, the `vite-plugin-dts` options — lives inline in every
file, so a build-policy change (sourcemap, a new external, the `require`/
`default` export-condition class of bug CLAUDE.md warns about) means editing
every file and risks "fix all but one".

## Approach

Extract the truly-identical build policy into a **pure** helper at
`scripts/lib/pluginViteConfig.ts` (the established home for tested build
helpers — cf. `scripts/lib/legacyPaths.ts` + `test/scripts/test_legacyPaths.ts`).
It is a repo-root script helper, **not** a workspace package, so there is no
new npm package, no version bump, and no build-orchestration tier / launcherSync
impact.

Design principle from the issue: build config is a domain where explicitness has
value, so the factory hides **only** what is identical across a family, and each
config still declares its own variables (entry, external, name, globals). Plugin
instances (`vue()`, `tailwindcss()`, `dts()`) are **dependency-injected** by the
caller — the helper imports only `import type` from `vite`, so it stays pure
(zero runtime deps) and unit-testable without loading the vite plugin packages.

### Config families (from diffing all 17 `vite.config.ts`)

- **Family A — Vue multi-entry library, dual ESM+CJS** (`createVuePluginConfig`):
  chart, html, markdown, form, mulmoscript, accounting, collection.
  Identical: `formats: ["es","cjs"]`, the dual `fileName`, `output.exports:
  "named"`, `output.assetFileNames: "style.[ext]"`, `cssCodeSplit: false`.
  Per-config: `entry`, `external`, optional `name`, `globals` (default
  `{ vue: "Vue" }`; chart adds `echarts`), optional `minify`/`sourcemap`.
- **Family B — server-only, single-entry, `vite-plugin-dts`, ESM-only**
  (`createServerPluginConfig` + `SERVER_DTS_OPTIONS`): google, edgar, email.
  Identical: dts options `{ include: ["src/**/*.ts"], outDir: "dist",
  compilerOptions: { rootDir: "src" } }`, `entry { index }`, `formats: ["es"]`,
  the ESM `fileName`, `minify: false`, `sourcemap: true`. Per-config: `external`.

### Deliberately deferred (documented, not converted)

- **core** (`packages/core/vite.config.ts`) — bespoke ~30-entry config, being
  actively edited by other in-flight PRs; high conflict, left as-is.
- **runtime sandbox family** (bookmarks, debug, spotify, recipe-book) — a third
  shape (vue + dts + a `style.css`-pinning `assetFileNames` **function**); these
  are tarball-extracted/dynamically-loaded and higher-risk. Highest-value
  follow-up.
- **x-plugin** — unique shape (dts, no vue, dual-format, `exports: "named"`, no
  external); one-off, not worth a parameter.

### Discovered asymmetry (preserved, not "fixed")

Within Family A, chart/html/markdown/form omit `minify`/`sourcemap` (→ minified,
no sourcemap) while mulmoscript/accounting/collection set `minify:false,
sourcemap:true`. This is pre-existing drift; the factory preserves each config's
current behavior exactly (optional passthrough). Noted for review, not changed.

## Verification

- Behavior-identical: before/after `dist` file-list + hash comparison on the
  standalone Family A plugins (chart/html/form) and the full `yarn build` gate.
- Unit test `test/scripts/test_pluginViteConfig.ts`: pure builders produce the
  exact expected `build` shape for each family + `SERVER_DTS_OPTIONS`.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, affected `yarn test`.

## Steps

1. Plan (this file), commit `docs(plan)`.
2. Add `scripts/lib/pluginViteConfig.ts` (pure factory).
3. Convert the 10 configs (Family A ×7, Family B ×3) to call it.
4. Add `test/scripts/test_pluginViteConfig.ts`; append 1 line to
   `docs/shared-utils.md`.
5. Verify (format/lint/typecheck/build/test + dist diff), commit `refactor(build)`,
   push, open PR (no merge).
