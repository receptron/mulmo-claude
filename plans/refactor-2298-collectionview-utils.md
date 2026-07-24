# refactor(collection-plugin): CollectionView.vue — safe layer only (#2298)

## Scope

Issue #2298 proposes a full split of
`packages/plugins/collection-plugin/src/vue/components/CollectionView.vue` (2945 lines)
into composables + utils + child components.

**This PR does ONLY the safe layer.** The template → child-component split (the highest
e2e-regression risk of the five large files in #2292–#2296) and the stateful composables
(`useViewMode`, `useCollectionActions`, `useFlagFilters`, …) are **deferred** to a follow-up.

## In scope (this PR)

1. **Extract genuinely pure functions** out of the `.vue` script into their own files, each
   with tests. Only functions with no Vue reactivity / `ref` / `computed` / DOM access move.
   The `.vue` keeps working by importing them from the new location — behaviour identical.

   Target destinations:
   - Sort helpers (`scalarSortValue` / `sortValueOf` / `derivedSortValue`) →
     `packages/core/src/collection/core/sortValueOf.ts` (next to `sortItems.ts`).
   - `itemMatchesQuery` (text search) → `packages/core/src/collection/core/textSearch.ts`.
   - `flagValueOf` / `completionCoveredByFieldChip` → next to `completion.ts`.
   - `generateUniqueItemId` → next to `ids.ts`.
   - Vue-adjacent-but-pure key/pref helpers (`cellKey` / `rowId` / `storedSortFor` /
     `storedFlagFiltersFor` / `snapshotEmptyEnums`) → plugin-local `vue/` util file, only
     if they are actually pure (verified case by case; impure ones stay put and are reported).
   - `buildChatSeed` — **check for an existing duplicate in
     `core/collection/core/presentCollection.ts` FIRST**; reuse rather than move if so.

2. **One named cross-file dedup**: the click-outside dropdown pattern is copy-pasted 3× in
   this file (`filterMenu`, `relatedMenu`, `addMenu`). The host has
   `src/composables/useClickOutside.ts` but the plugin may not import from host `src/`
   (package dependency direction, CLAUDE.md). Create a plugin-local
   `packages/plugins/collection-plugin/src/vue/composables/useClickOutside.ts` and collapse
   the 3 copies to it. Add a `docs/shared-utils.md` row noting the deliberate host/plugin split.

## Explicitly OUT of scope (deferred)

- Template → child components (`CollectionHeader.vue`, `CollectionToolbar.vue`,
  `CollectionTable.vue`, `CollectionCell.vue`, `CollectionChatModal.vue`,
  `CollectionRepairBanner.vue`). Highest e2e risk — `collections-row-<id>` on the root `<tr>`,
  `thead th` structural dependency in `collection-image-field.spec.ts`.
- Stateful composables (`useViewMode`, `useCollectionActions`, `useFlagFilters`,
  `useTableSort`, `useRelatedMenu`, `useLiveCollectionRefresh`, `useRecordPanelState`,
  `useCollectionChat`).

## Constraints

- No `data-testid` may change. If moving a pure function would change a testid or DOM
  structure, it is NOT moved — it is reported instead.
- Package dependency direction: plugin code may import `@mulmoclaude/core/*`, never host `src/`.
- No `any`, no `as` casts, functions under 20 lines.
- Tests live in the repo test tree (`packages/core/test/collection/…` for core helpers).

## Verification

- Every extracted pure function gets unit tests (happy path + edges).
- Mutation check: break `sortValueOf`, confirm a test goes RED, restore.
- Gate: `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`; plugin builds.
