# feat — related-collections pulldown in the collection header

Navigation gap: when a collection is related to others (its refs point at
them, or their refs/backlinks point at it), hopping between them requires
going back to the index or clicking through a record's ref cell. Add a
pulldown to the collection view's top toolbar listing the related
collections, one click to navigate.

## Data source (no server change)

The plugin's host contract already exposes everything needed:

- `collectionUi().fetchOntology?.()`
  (`packages/plugins/collection-plugin/src/vue/uiContext.ts:317`) — the
  optional capability backing the index Map tab; MulmoClaude wires it in
  `src/composables/collections/uiHost.ts:170`. Returns
  `CollectionOntologyEntry[]`: slug, title, icon, recordCount, and every
  relation (`ref` / `embed` / `backlinks` / `rollup`, incl. table-nested
  dotted refs).
- `buildOntologyGraph(entries)` — browser-safe export of
  `@mulmoclaude/core/collection` (`core/ontologyGraph.ts`). Its edges
  already collapse a backlinks/rollup reverse side onto the forward `ref`
  edge (`reverseFields`), so a bidirectional pair yields ONE neighbor.

## Neighbor derivation (pure helper)

New `packages/plugins/collection-plugin/src/vue/relatedCollections.ts`:

```ts
export interface RelatedCollection {
  slug: string;
  title: string;
  icon: string;
  direction: "out" | "in" | "both";
}
export function relatedCollections(entries: CollectionOntologyEntry[], slug: string): RelatedCollection[];
```

- Build the graph, take edges where `from === slug` (direction `out`) or
  `to === slug` (`in`); an edge carrying `reverseFields`, or a slug hit in
  both directions, collapses to one entry with `both`.
- Skip `missing` (ghost) nodes — nothing to navigate to.
- Skip self-edges (a collection ref-ing itself).
- Title/icon come from the node entry; stable order (graph node order =
  slug-sorted).

Pure + exported → unit-testable, keeps component functions under the
20-line rule.

## UI (CollectionView.vue header)

Placement: the header row (`CollectionView.vue:3`), next to the Chat
button. Copy the two existing in-component pulldown patterns (flag-filter
menu ~line 186, add-view menu ~line 293), per `docs/ui-controls.md` — no
new control sizes:

- Trigger: icon + label pill `h-8 px-2.5 flex items-center gap-1`,
  Material icon `hub`, label `t("collectionsView.related")`,
  `aria-expanded`, testid `collections-related-menu`.
- Panel: `relative` wrapper + `absolute right-0 top-full mt-1 z-20
  min-w-max rounded border border-slate-200 bg-white shadow-lg py-1`
  (right-aligned — the trigger sits near the header's right edge),
  testid `collections-related-menu-panel`.
- Close on outside `mousedown` via the existing `eventInsideElement`
  helper, same add/remove-listener watch the other two menus use.
- Item: `w-full h-8 px-3 flex items-center gap-2 text-xs` — the target
  collection's icon (`material-symbols-outlined`), its title, and a
  trailing direction icon: `arrow_outward` (out), `arrow_back` (in),
  `sync_alt` (both) with direction tooltips. Testid
  `collections-related-item-<slug>`. Material icons only, no emojis.
- Click → `collectionUi().gotoDetail("collection", slug)` (same call as
  the index cards), then close the menu.

Visibility: render the trigger when `collection` is loaded, `!embedded`,
and the `fetchOntology` capability exists (MulmoTerminal-safe — absent
capability hides the control, same additive pattern as the Map tab).

## Lazy fetch (chosen strategy)

Do NOT fetch on mount — the ontology endpoint scans all schemas and
counts record files, and most view opens never touch the pulldown.

- Fetch on FIRST open of the menu; cache the derived neighbor list per
  slug for the component's lifetime (re-fetch on slug change only).
- While in flight: a single disabled `hourglass_empty` row.
- `ok: false` or zero neighbors: a single disabled empty-state row,
  `t("collectionsView.relatedEmpty")` — fail-soft, consistent with the
  rest of the collection UI (no error toast).
- Consequence accepted: the trigger is visible even for collections with
  no relations; the empty state answers the click.

## i18n

New keys in ALL 8 plugin locales (`src/vue/lang/{de,en,es,fr,ja,ko,ptBR,zh}.ts`)
in lockstep, per `docs/i18n.md`:

- `collectionsView.related` — trigger label
- `collectionsView.relatedEmpty` — empty-state row
- `collectionsView.relatedOut` / `relatedIn` / `relatedBoth` — direction
  tooltips (`title`/`aria-label` on the direction icon)

## Files

- `packages/plugins/collection-plugin/src/vue/relatedCollections.ts` — new
  pure helper.
- `packages/plugins/collection-plugin/src/vue/components/CollectionView.vue`
  — trigger + panel + lazy-load state.
- `packages/plugins/collection-plugin/src/vue/lang/*.ts` — 5 keys × 8
  locales.
- `packages/plugins/collection-plugin/package.json` — bump `0.14.1` →
  `0.15.0` (feature); launcher dep range lockstep in
  `packages/mulmoclaude/package.json`. No `@mulmoclaude/core` change
  (everything needed is already exported) and no core-range ratchet.
- Tests:
  - unit — `relatedCollections` helper: out/in/both directions,
    backlinks-collapse dedup, ghost skip, self-edge skip, empty.
  - e2e (mock) — new `e2e/tests/collection-related-menu.spec.ts` modeled
    on `collection-ontology-map.spec.ts` (ontology fixtures exist there):
    trigger visible, open → items listed, click → navigates to the target
    collection; empty-state row for an unrelated collection.

## Non-goals

- No record-level hops (the ref cells / backlinks sub-tables already do
  that) — this menu navigates collection → collection only.
- No new server route, no `CollectionUi` contract change.
- No MulmoTerminal port needed: purely additive Vue-layer change; hosts
  without `fetchOntology` simply don't render the control.

## Verification

- `yarn test` (helper unit tests) + `yarn test:e2e` (new spec) green.
- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` green.
- Manual: workspace with `portfolio` ↔ `stock-quotes` style relations —
  hop both directions from the header; unrelated collection shows the
  empty row; embedded views show no trigger.
