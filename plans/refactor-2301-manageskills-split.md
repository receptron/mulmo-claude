# refactor(#2301): manageSkills View.vue — component/composable split (step 2)

Refs #2301. Follows the merged **safe-layer** PR (#2381), which extracted
the pure helpers (`entryKey`, `catalogActionParams`, `groupEntriesByRepo`,
`skillBadgeMeta`, `PRESET_SOURCE_META`, `repoLabel`) into `categories.ts`
**with tests**. This step does the deferred follow-up: the stateful
**composables**.

## Why composables, not child components (this step)

The issue calls a template→child-component split the primary prescription,
but the safe-layer plan deferred it because of the **dynamic-testid
hazard**:

- `:data-testid="isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'"`
- `:data-testid="`skill-catalog-item-${entryKey(entry)}`"`

A careless prop hand-off into a child component would silently flip a
testid and break `e2e/tests/skills.spec.ts`. Composable extraction moves
**only `<script setup>` logic** — the `<template>` is left **byte-for-byte
unchanged**, so every `data-testid`, DOM nesting level, and `v-show`
toggle the e2e traverses is provably identical. This is the safe way to
advance the split before touching the DOM.

## entryKey test coverage (prerequisite — already satisfied)

The issue insists "entryKey のテストが先". `entryKey` already has thorough
unit tests in `test/plugins/manageSkills/test_categories.ts` (external vs
preset, slug-collision-across-repos, missing-repoId/skillFolder fallback),
added by the safe-layer PR. No further entryKey work is required before
relying on it. This step still touches the identity-bearing helpers only
through the already-tested `categories.ts` surface.

## Slices (each: build + unit tests green)

1. **`useSkillMarkdown.ts`** (composable) — dedup the flagged duplication:
   `renderMarkdownToSafeHtml(body)` + `useMermaidRenderer(ref, rendered)`
   appears twice (`renderedBody`, `catalogRenderedBody`). One composable
   `useSkillMarkdown(() => body)` → `{ markdownRef, renderedBody }`. Two
   call sites collapse to one.

2. **`categories.ts` `toggleInSet<T>` (pure) + tests** — `toggleSection`
   and `toggleRepo` both "clone the Set, add-or-delete the key, replace
   wholesale, persist". Extract the pure add-or-delete into
   `toggleInSet(set, key): Set<T>`, test it (present→removed,
   absent→added, immutability of the input), and use it in both handlers
   (in the parent and in `useExternalRepos`). New pure logic ⇒ new tests.

3. **`useSkillCatalog.ts`** (composable) — preset-catalog cluster:
   `catalogPresets` / `catalogExternal` / `catalogError` / `selectedCatalog`
   / `catalogDetail` / `catalogDetailLoading` / `catalogActioningKey`,
   `loadCatalog`, `selectCatalogEntry`, `starCatalogEntry`,
   `fetchCatalogDetail`, `selectedCatalogKey`, catalog markdown (via slice
   1), plus `clearSelection` / `clearSelectionIfRepo` / `reconcileAfterDelete`
   / `reset`. Depends outward on `refreshActiveList` +
   `clearActiveSelection` callbacks (parent-owned, defined first ⇒ no
   forward refs).

4. **`useExternalRepos.ts`** (composable) — external-repo cluster:
   `catalogRepos`, `externalGroups` (from injected `catalogExternal` +
   owned `catalogRepos`), `repoCollapsed` / `isRepoOpen` / `toggleRepo`,
   the add-repo modal state, `suggestions` / `selectedSuggestionUrl`,
   `uninstallingRepoId` / `updatingRepoId`, `loadExternalRepos`,
   `openAddRepo`, `selectSuggestion`, `installRepo`, `uninstallRepo`,
   `updateRepo`, `resetModalState`. A leaf: it only calls **outward**
   (`reloadCatalog`, `refreshActiveList`, `clearCatalogSelectionForRepo`);
   nothing in the parent's selection core calls back into it.

The **parent** keeps the active-skill domain (`skills`, `selectedName`,
`detail`, edit/save/delete, `refreshActiveList`) plus section-collapse and
badge wrappers, and orchestrates the two composables. Active-detail and
catalog are genuinely bidirectionally coupled (starring adds to the active
list; deleting an active skill re-syncs the catalog), so the active domain
stays in the coordinator to avoid fragile forward-reference wiring.

## Why the DOM stays identical

- `<template>` is not edited at all (verified by `git diff` on the
  template region == empty).
- Composables return the exact same reactive names the template binds;
  they are destructured at `<script setup>` top level so template
  bindings resolve unchanged.
- Pure helpers used in the template (`entryKey`, `repoLabel`) keep their
  imports in the parent.

## Constraints

Composition API; `ref` over `reactive`; relative imports; `emit` (n/a —
no new components); `$t()`/`t()` for text; no `v-html` change; functions
< 20 lines; no `any`; no `as`. No `data-testid` touched. No version bumps.

## Out of scope (still deferred)

- [ ] template → child components (`SkillCatalogList.vue`,
      `SkillRepoGroup.vue`, `SkillDetailPane.vue`, `AddRepoModal.vue`,
      `SkillActiveList.vue`, `CatalogDetailPane.vue`) — the dynamic-testid
      hazard; a separate PR that changes the DOM under e2e cover.
- [ ] `useSkillDetail.ts` — kept in the parent this round (see above).
