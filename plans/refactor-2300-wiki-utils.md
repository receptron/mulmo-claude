# refactor(wiki): extract pure helpers from View.vue — SAFE LAYER ONLY (#2300)

Issue #2300 proposes a full split of `src/plugins/wiki/View.vue` (1118 lines) into
composables + child components + pure utils. **This plan covers ONLY the safe layer:
extracting the pure functions into the existing `src/plugins/wiki/helpers.ts`, each with
tests.** The template split and stateful composables are DEFERRED.

## Why the split is deferred (xpath hazard)

`e2e/tests/wiki-navigation.spec.ts:216` does:

```ts
const scrollContainer = wikiBody.locator("xpath=..");
```

It depends on the element carrying `data-testid="wiki-page-body"` having the scroll
container as its **direct DOM parent**. Wrapping the content body in a `WikiPageBody`
child component shifts that parent-child relationship by one level, which makes the test
**silently pass** (`scrollTop` stays 0, assertion trivially holds). This is the only
xpath-dependent e2e in the batch, so the template split is the riskiest one and is left
for a dedicated phase.

Whoever does the deferred template split MUST either:
- keep the `scrollRef` div as the direct parent of `wiki-page-body`, or
- first rewrite the spec to a testid-based scroll container lookup.

Do NOT touch any `data-testid` or the DOM nesting around `wiki-page-body` in this phase.

## In scope — pure functions to extract into `helpers.ts` (each WITH tests)

- `computeTagChips(entries, target)` — adaptive tag cutoff using `TARGET_FILTER_CHIPS`.
  Highest test value: singleton exclusion, tie handling at the cutoff boundary, cutoff on
  reaching TARGET. Prioritised.
- `metaString` / `metaStringArray` — frontmatter `unknown` → string / string[] normalisation.
- `formatUpdated` — `YYYY-MM-DD HH:MM` formatting. Check `docs/shared-utils.md` first
  (`toUtcIsoDate` has 3 impls) — reuse a catalogued helper if it fits rather than add a 4th.
- `computeToggledContent` — DOM passed in as an argument, rewrites markdown task lines. Pure.
- `splitFrontmatter` — frontmatter prefix/body splitter.

## The named dedup: `splitFrontmatter`

View.vue already imports `parseFrontmatter` from `@mulmoclaude/markdown-utils/markdown/frontmatter`
but hand-rolls its own splitter. The right fix (per the issue) is to add a prefix/body-returning
variant to `parseFrontmatter` in the markdown-utils package and use it. If that package change
is clean, do it (bump `@mulmoclaude/markdown-utils` + sweep consumer ranges). If it balloons in
scope, extract `splitFrontmatter` to `helpers.ts` with tests and record the package-level dedup
as a follow-up. The chosen path is documented in the PR body.

## Out of scope (DEFERRED)

- Template → child components (`WikiHeader.vue`, `WikiIndexList.vue`, `WikiMetadataBar.vue`,
  `WikiEmptyState.vue`, `WikiPageBody`). Blocked by the xpath hazard above.
- Stateful composables (`useWikiNavigation`, `useWikiPageEdit`, `useTagFilter`, `useWikiGraph`).

## Tests

Add to `test/plugins/wiki/` (alongside existing `test_helpers.ts`).

- `computeTagChips`: fewer tags than target; more than target (cutoff); singleton tags excluded;
  ties at the cutoff boundary; empty entries.
- `metaString` / `metaStringArray`: unknown types, arrays, null.
- `formatUpdated`: known timestamp, boundary.
- `computeToggledContent`: a task line toggled on/off; a non-task line left alone.

Then verify the tests are real: break `computeTagChips`'s cutoff, confirm a test goes RED, restore.
