# refactor(collection-plugin): split CollectionView.vue (#2298)

`packages/plugins/collection-plugin/src/vue/components/CollectionView.vue` is the
largest SFC in the repo (2818 lines: template 941 / script 1875). The safe-layer
PR (#2384, merged) already extracted the pure helpers and de-duplicated the
click-outside menus into `composables/useClickOutside.ts`. This is the NEXT step:
break stateful clusters out of the still-huge `<script setup>`.

## DOM-safety strategy (the governing constraint)

CollectionView has **51 `data-testid`s — the most of any SFC**, and #2298 flags
concrete structural traps: `collection-image-field.spec.ts` depends on the exact
`<thead><th>` hierarchy, and `collections-row-<id>` (6 specs) must stay on the
root `<tr>`. Any template/DOM edit risks those.

Therefore this PR extracts **composables only** — the `<template>` block is left
**byte-for-byte identical**. Moving reactive state + logic out of `<script setup>`
into `useXxx.ts` files changes zero rendered DOM, so every testid, every nesting
level, and every e2e traversal is provably unchanged. Template → child-component
extraction (which does touch DOM) is deferred to follow-up PRs where each subtree
can get its own byte-equivalence review.

Each composable is paired with a **pure, unit-tested display helper** so the move
also lands real test coverage on the "silently wrong" presentation logic
(a11y tokens, the hover-preview sort state machine, direction icons) that #2298
lists as an untested gap.

## Slices in THIS PR

### Slice A — `useRelatedMenu` (related-collections pulldown)

- New `src/vue/composables/useRelatedMenu.ts`: owns `relatedMenuOpen`/`relatedMenuRef`
  (via `useClickOutside`), `relatedLoading`, `relatedList`, `relatedFetchedSlug`,
  `showRelatedMenu`, `relatedItems`, `loadRelated`, `toggleRelatedMenu`,
  `gotoRelated`, `relatedDirectionLabel`, and a `resetForSlugChange()` for the
  `activeSlug` reset watch. Inputs (DI): `collection`, `embedded`, `cui`, `t`.
- New pure `src/vue/relatedMenuDisplay.ts`: `relatedDirectionIcon(direction)` and
  `relatedDirectionLabelKey(direction)` (direction → icon glyph / i18n key).
- Component keeps the template unchanged; the reset watch calls
  `resetForSlugChange()` instead of nulling the four refs by hand.
- Test: `test/utils/collections/test_relatedMenuDisplay.ts` — all three directions
  (out / in / both) for icon + label key.

### Slice B — `useTableSort` (list-table column sort)

- New `src/vue/composables/useTableSort.ts`: owns `sortState` (writable ref,
  returned so the parent's persist watch keeps working), `hoveredSortKey`,
  `sortDirectionFor`, `effectiveSortDir`, `cycleSort`, `sortIconName`,
  `sortButtonClass`, `sortAriaValue`, `sortedItems`, and `resetForSlug(slug)`.
  Inputs (DI): `collection`, `tableFilteredItems`, `activeSlug`, `sortValueDeps`.
- New pure `src/vue/tableSortDisplay.ts`: `previewSortDir(current, isHovered)`,
  `sortIconNameForDir(dir)`, `sortButtonClassForDir(dir)`, `sortAriaTokenForDir(dir)`.
- Component keeps the template unchanged; the `activeSlug` reset watch calls
  `resetForSlug(slug)`; the persist watch still reads the returned `sortState` ref
  and calls `writeCollectionSort`.
- Test: `test/utils/collections/test_tableSortDisplay.ts` — icon/class/aria tokens
  for asc / desc / null, plus the hover-preview transitions
  (none→asc, asc→desc, desc→none).

Net: ~130 script lines leave the SFC into 2 composables + 2 pure files, template
untouched. Reviewable diff, maximal DOM safety.

## Deferred (follow-up PRs, tracked on #2298)

Composables with heavier coupling or no clean pure rule, and every template →
child-component split (each needs its own byte-equivalence pass):

- `useViewMode`, `useCollectionActions`, `useFlagFilters`,
  `useLiveCollectionRefresh`, `useRecordPanelState`, `useCollectionChat`
- `CollectionHeader.vue`, `CollectionToolbar.vue`, `CollectionTable.vue` +
  `CollectionCell.vue`, `CollectionChatModal.vue`, `CollectionRepairBanner.vue`

## Verification

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`. Because
the template is byte-identical, the collection mock e2e path is unaffected; the
DOM the specs traverse is unchanged by construction. No version bumps.
