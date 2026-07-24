# refactor(#2460): fold byte-identical host↔core helpers into their canonical homes

Issue #2460 lists the three host↔package clones left over from the #2412 sweep
where the fold is unconditionally safe: two are **byte-identical** to a helper
core already exports on a legally importable (host → core) subpath, and the
third is an identical-except-name pair whose natural shared home
(`@mulmoclaude/core/translation/client`) both sides already depend on.

Each claim was re-verified against the current sources before editing — all
three held (bodies byte-identical; only names / doc comments differ).

## Done (behavior-preserving)

| # | Host copy | Canonical home | Change |
|---|-----------|----------------|--------|
| 1 | `server/utils/files/naming.ts` `yearMonthUtc` | `@mulmoclaude/core/artifacts` (`packages/core/src/artifacts/paths.ts`, exported since #2405) | Deleted the host copy; `naming.ts` and the three direct importers (`image-store.ts`, `attachment-store.ts`, `spreadsheet-store.ts`) import the core one. The neighboring `buildArtifactPath` / `buildArtifactPathRandom` stay host-side untouched — their `slugify` (crypto-hash non-ASCII fallback) deliberately differs from core's `slugifyArtifact`. |
| 2 | `src/utils/markdown/wikiEmbeds.ts` `escapeHtml` | `@mulmoclaude/core/wiki` barrel (`packages/core/src/wiki/render.ts`) | Deleted the local copy; `wikiEmbeds.ts` and every consumer that imported it from there (`wikiEmbedHandlers.ts`, spreadsheet `View.vue`, `test_wikiEmbeds.ts`) import the core barrel — the same barrel `src/plugins/wiki/helpers.ts` already uses. |
| 3 | `src/composables/useTranslatedStrings.ts` `loadInto` ↔ `collection-plugin/src/vue/useStarterTranslations.ts` `loadBatch` | new `loadTranslated(cache, req, isCurrent, apply)` in `@mulmoclaude/core/translation/client` | The cache is parametrized (each caller keeps its own module-singleton cache and transport closure); both call sites now delegate. Semantics preserved exactly: synchronous peek hit applies without the guard, a resolved fetch applies only while `isCurrent()` holds, `null` results and rejections are dropped (English fallback stays). |

## New tests

`packages/core/test/translation/test_client.ts` — `createTranslationCache` /
`loadTranslated` had **no** coverage anywhere. Pins: peek hit applies
synchronously without fetching, fetch path, stale result discarded by the
`isCurrent()` guard, `null` result not applied, fetch rejection swallowed,
empty request round-trip, and the memo/no-re-fetch integration with the real
cache. Mutation-checked: inverting the `isCurrent()` guard turns 4 cases red.

Folds 1–2 are pure import swaps of byte-identical functions; existing suites
(`packages/core/test/artifacts/test_paths.ts` for `yearMonthUtc`,
`test/utils/markdown/test_wikiEmbeds.ts` for `escapeHtml` + the marked
integration) keep covering them.

## Catalog / docs

`docs/shared-utils.md`: new row for `loadTranslated`; the `naming.ts` /
`wikiEmbeds.ts` rows drop the folded helpers; the duplicates table marks
`yearMonthUtc` **Resolved (#2460)** and drops `escapeHtml` to 4 copies
(spotify-plugin, markdown-utils, runtime-plugin inline remain — out of scope,
they are the chained-`.replace` spelling family in other packages).

No package `version` bumped → no dep-range sweep needed (ships with the next
`@mulmoclaude/core` release).

## Verification

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`
- jscpd re-run with the CI flags (`--format typescript`, same `--ignore`)
  confirms the three targeted clone pairs (alerts #427, #192, #224) are gone
  with no new clones introduced.
