# refactor #2410 — core/wiki frontmatter splitter duplicates `@mulmoclaude/markdown-utils`

Follow-up to #2382. Date: 2026-07-23.

## Problem

`packages/core/src/wiki/server/frontmatter.ts` carries its own copy of the
`---\n…\n---\n` YAML-frontmatter parser (`parseFrontmatter` + `safeYamlLoad`
+ the `FRONTMATTER_OPEN` / `FRONTMATTER_CLOSE` regexes). This is a
byte-for-byte fork of the canonical parser that already lives in
`@mulmoclaude/markdown-utils` (`packages/markdown-utils/src/markdown/frontmatter.ts`).
jscpd flags 98 tokens / 18 lines. #2382 removed the *other* hand-copy (in
`src/plugins/wiki`) by folding it onto `@mulmoclaude/markdown-utils`; this
one was left behind.

## Decision — single-source on markdown-utils (no fork)

`@mulmoclaude/markdown-utils` is a **leaf** shared lib, so
`@mulmoclaude/core` → `@mulmoclaude/markdown-utils` is a legal *downhill*
edge per the package-dependency-direction rule. This adds a **new** edge
(core did not depend on markdown-utils before), which is the right trade:
delete the fork rather than pin a diff.

markdown-utils' `parseFrontmatter(raw)` returns `{ meta, body, hasHeader }`
— a strict **superset** of core/wiki's `{ meta, hasHeader }`. Every case
core/wiki relied on (no envelope, empty `---\n---\n` envelope, malformed
YAML, CRLF fences, FAILSAFE_SCHEMA string-preservation) is already handled
identically by the markdown-utils implementation (same regexes, same
`safeYamlLoad`). **No wiki-specific behaviour is missing**, so there is
nothing to port up into markdown-utils and **markdown-utils is not
modified** (no version bump, no CHANGELOG entry, no consumer sweep).

## Changes

1. `packages/core/src/wiki/server/frontmatter.ts`
   - Delete `FRONTMATTER_OPEN`, `FRONTMATTER_CLOSE`, `parseFrontmatter`,
     `safeYamlLoad` (the duplicated block) and the `js-yaml` import.
   - Re-export `parseFrontmatter` from
     `@mulmoclaude/markdown-utils/markdown/frontmatter` (keeps the public
     `@mulmoclaude/core/wiki/server` barrel export stable — now returns the
     richer `{ meta, body, hasHeader }`).
   - Keep the wiki-specific `parseFrontmatterTags` + `cleanTagToken`
     (a narrow `tags:` reader that is NOT part of markdown-utils), now
     delegating to the imported `parseFrontmatter`.

2. `packages/core/package.json`
   - Add `"@mulmoclaude/markdown-utils": "^1.3.0"` to `dependencies`
     (matches the workspace version 1.3.0 and every other consumer's
     declared range; keeps the launcherSync invariant untouched).

3. `packages/core/vite.config.ts`
   - Externalize `@mulmoclaude/markdown-utils` so the published `core`
     resolves it as a runtime dep instead of bundling a second copy
     (defeats the dedup otherwise, and would risk pulling the mermaid/vue
     peers into a server bundle).

4. `packages/core/test/wiki/test_frontmatter.ts` (new)
   - Lock the behaviour core/wiki relies on through the new delegation:
     no frontmatter, empty envelope, CRLF fences, flow + block-list tags,
     `#`/quote token cleaning, non-string tag filtering, malformed YAML.

## Version discipline

- markdown-utils: **unchanged** → no bump, no sweep.
- core: implementation-only change, **public API preserved** (same exports,
  same signatures; return shape only widens). Not bumping core's `version`
  in this PR — it is still the unpublished 1.1.0 accumulating changes, and
  on the 1.x line `^1.1.0` already floats to any later 1.x, so no consumer
  sweep is forced. Flagged for the reviewer to confirm at release time.
- launcher `version`: never touched.

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, and
`yarn workspace @mulmoclaude/core test` (new frontmatter test green;
existing wiki tests green).
