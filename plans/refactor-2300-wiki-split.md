# refactor(wiki): split `View.vue` into components + composables (#2300)

## Context

`src/plugins/wiki/View.vue` is ~1029 lines. The safe-layer PR (#2382, merged)
already extracted **all pure helpers** into `helpers.ts` and covered them with
`test/plugins/wiki/test_helpers.ts` (`metaString` / `metaStringArray` /
`formatUpdated` / `computeTagCounts` / `computeTagChips` / `computeToggledContent`
are all tested). This PR does the **next** step: break the component body into
child components and composables so the parent becomes an orchestrator.

## Hard constraint — e2e is xpath-sensitive

`e2e/tests/wiki-navigation.spec.ts:216` does:

```js
const wikiBody = page.getByTestId("wiki-page-body");
const scrollContainer = wikiBody.locator("xpath=..");  // DIRECT parent of wiki-page-body
```

The scroll test depends on `wiki-page-body`'s **direct DOM parent** being the
`ref="scrollRef"` div. If we wrap or relocate that region, the parent/child
relationship shifts one level and the assertion silently passes against a
non-scrolling element.

Additional invariant: `ref="scrollRef"` is reused (single name) across four
mutually-exclusive `v-if` branches — index list, page content, page-edit, log.
The parent's `watch(content)` resets `scrollRef.value.scrollTop = 0`. Extracting
**any** scrollRef-bearing div into a child severs that ref binding and breaks the
scroll reset for that view.

### Regions we deliberately DO NOT touch

- **Page content tab body** (template ~264-331): `wiki-page-body`'s parent must
  stay the `scrollRef` div. Never wrap/extract this subtree.
- **Any scrollRef-bearing div** (index list, page-edit body, log/lint body):
  left inline so the parent keeps the `scrollRef` binding + scroll reset.
- **Page tabs strip, per-page empty states, graph region, index list**: left
  inline this PR. They are candidate future slices but sit near scrollRef /
  xpath-traversed DOM, so they stay for a follow-up.

All 25 `data-testid`s keep their exact string, DOM nesting, and layout classes.

## Follow-up slice (`refactor/2300-wiki-children`) — 681 → 632

Of the four regions deferred above, exactly two turned out to be provably safe;
the other two are permanently blocked. This follow-up takes the two safe ones and
closes out the split.

### Extracted

| Component | Region | Why safe |
|---|---|---|
| `WikiGraphTab.vue` | graph tab (`wiki-graph`) | Own `v-else-if` branch. No `scrollRef`, no `wiki-page-body`, no scoped-style class. The graph spec only touches `wiki-tab-graph` (WikiHeader), `wiki-graph-canvas` (WikiGraphView) and `wiki-linked-references` (content body) — none traverse from this div. |
| `WikiPageTabs.vue` | page tab strip (`wiki-page-tabs`) | A **sibling** of the `scrollRef` div, never an ancestor of `wiki-page-body`, so `wikiBody.locator("xpath=..")` is untouched. No `scrollRef`, no scoped-style class. |

`PAGE_TAB` / `PageTab` moved to `src/plugins/wiki/pageTab.ts` so the parent (which
still needs them for the `v-show` / composer guards) and `WikiPageTabs` share one
definition instead of hardcoding the tab strings twice.

### Permanently blocked (do not retry)

- **Index list** — carries BOTH hazards: `ref="scrollRef"` on its scroll div
  (extracting severs the parent's ref binding, silently killing the scroll reset)
  AND the scoped `.entry-tag-chip` class on its per-entry chips.
- **Page content body / page-edit body / log-lint body** — each carries
  `ref="scrollRef"`, and the content body additionally owns the
  `wiki-page-body → scrollRef` parent/child pair the xpath test asserts on.
- **Per-page empty states** — live *inside* the content body's `scrollRef` div as
  the `v-if`/`v-else-if` arms whose `v-else` is `WikiPageBody`; splitting them
  would break that chain.

With those blocked, 632 lines is the safe floor for `View.vue` short of first
rewriting `wiki-navigation.spec.ts:216` off its xpath traversal.

## Slices

### A. Composables — `src/plugins/wiki/composables/` (zero DOM impact)

Composables move **script only**; the rendered template is untouched, so they
carry no xpath/testid risk.

| Composable | Moves out | Deps injected |
|---|---|---|
| `useWikiNavigation.ts` | `pushWiki` / `navigate` / `navigatePage` / `currentSlug()` / `currentSlugReactive` / `isStandaloneWikiRoute` | `pageWikiRoute`, `pageNameFromResult()` |
| `useTagFilter.ts` | `selectedTag` / `tagCounts` / `allTags` / `visibleEntries` / `toggleTagFilter` / `setTagFilter` + clear-on-leave watcher | `pageEntries`, `action` |
| `useWikiGraph.ts` | `graphData` / `graphError` / `loadGraph` / `syncGraphFromResult` / `linkedReferences` | `action`, `pageExists`, `currentSlug` (ref), `endpointBase` |
| `useWikiPageSave.ts` | task-checkbox save chain (`persistWikiPage` / `onTaskCheckboxClick` / queue generation) | `action`, `content`, `navError`, `currentSlug()`, `endpointBase`, `refresh` |
| `useWikiPageEdit.ts` | `pageEditTs` / `pageEditBanner` / `pageEditDeleted` / `loadPageEditData` / `resetPageEdit` | `content` |

`currentSlug()` is DRYed to `() => currentSlugReactive.value` (the original kept
two identical bodies with a "Mirrors the imperative body" comment).

Data-fetch orchestration (`callApi` / `applyWikiResult` / `useFreshPluginData` /
the two watchers / `onMounted`) **stays in the parent** — it writes the shared
view refs, emits `updateResult`, and calls `syncGraphFromResult`. The parent is
the orchestrator that wires the composables together.

`navError` stays declared early in the parent (TDZ constraint: the
`immediate: true` URL watcher runs `callApi` synchronously during setup).

### B. New pure helper (tested) — `helpers.ts`

- `shouldLazyLoadGraph(action, pageExists, hasGraph): boolean` — the branch
  exposed by moving `syncGraphFromResult`. Silently-failing rule (a wrong
  condition means backlinks never load), so it gets its own unit test.

### C. Template child components — `src/plugins/wiki/components/`

Both are **single-root**, **off the xpath path**, and contain **no scrollRef**,
so their emitted DOM is byte-equivalent to the inlined markup.

| Component | Template region | Root element | testids inside |
|---|---|---|---|
| `WikiHeader.vue` | header row (~4-91) | the header `<div class="flex items-center justify-between …">` | `wiki-zip-button`, `wiki-lint-chat-button`, `wiki-tab-graph` |
| `WikiMetadataBar.vue` | metadata bar (~187-215) | `<div data-testid="wiki-page-metadata-bar">` | `wiki-page-metadata-{bar,created,updated,editor,tags}`, `wiki-page-metadata-tag-<tag>` |

Props in, `emit` out (no function props). `$t()` used for text inside children.
The `v-if` guarding each region stays on the parent's `<WikiHeader>` /
`<WikiMetadataBar>` tag, so conditional rendering is identical.

## Why DOM stays identical

- Composables never touch the template.
- Child components have a single root equal to the div they replace; Vue renders
  that root in place of the tag, so nesting, classes, attributes, and testids are
  byte-for-byte the same.
- No scrollRef div is moved; the xpath-critical `wiki-page-body → scrollRef`
  parent/child relationship is left completely alone.

## Verification

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`. Wiki
mock e2e (`e2e/tests/wiki-navigation.spec.ts`) run if feasible; otherwise rely on
the unchanged DOM argument above and say so in the PR. No version bumps.
