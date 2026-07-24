# refactor(#2301): extract View.vue template subtrees into child components

## Context

`src/plugins/manageSkills/View.vue` is **827 lines** after the merged composable
split (#2456 / #2381). #2301 asks for the **template → child-component** step that
#2456 deliberately deferred, because the SFC carries **dynamic `data-testid`s** that
a careless prop hand-off could silently reshape:

- `:data-testid="isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'"`
- `:data-testid="`skill-catalog-item-${entryKey(entry)}`"`
- `:data-testid="`skill-catalog-starred-indicator-${entryKey(entry)}`"`
- `:data-testid="`skill-catalog-repo-${group.repo.repoId}`"` (+ `-toggle/-update/-uninstall`)

The single e2e spec `e2e/tests/skills.spec.ts` (plus `settings.spec.ts`, which only
asserts `skill-section-catalog`) is the safety net. Every extracted subtree MUST
reproduce every testid — static AND computed — byte-identically, with the same
computing expression.

**Favorable fact:** no `<style scoped>` in this SFC — child extraction cannot break
scoped-style hashes.

## Candidate children (from the issue)

| Subtree | Lines | Dynamic-testid hazard | Decision |
|---|---|---|---|
| Add-repo modal | 397–479 | `skill-add-repo-suggestion-${url}` (via prop object — safe) | **EXTRACT** |
| Catalog (preset/external) detail pane | 254–294 | none flip (`-detail-pane/-star-btn/-starred`) | **EXTRACT** |
| Active-skill detail pane | 297–389 | **flips** `skill-unstar-btn`/`skill-delete-btn` + edit v-models + markdown ref + 4 emits | defer |
| Left Catalog list + repo groups | 88–244 | `skill-catalog-item-${entryKey}` + heavy selection coupling | defer |
| Left Active list | 38–87 | `skill-item-${name}` + selection coupling | defer |

## Chosen safe subset (this PR)

Both chosen subtrees are **OFF the flipping-testid hot path** and self-contained.

### 1. `AddRepoModal.vue`
The safest target: a self-contained modal, no `v-html`, no template refs, no flipping
testid. The parent keeps `v-if="addRepoOpen"` on the `<AddRepoModal>` tag (identical
mount/unmount), so the child's root is the `data-testid="skill-add-repo-modal"`
overlay — byte-identical.
- **props / v-model:** `v-model:url`, `v-model:subpath` (defineModel, Vue 3.5), plus
  read props `error`, `busy`, `suggestions`, `selectedSuggestionUrl`.
- **emits:** `close`, `install`, `select-suggestion` (payload = suggestion).
- Dynamic testids `skill-add-repo-suggestion-${suggestion.url}` /
  `-link-${suggestion.url}` reproduce byte-identically — same `suggestion` objects
  passed straight through as a prop.

### 2. `CatalogDetailPane.vue`
Rendered by `v-if="selectedCatalog"` (kept on the parent's `<CatalogDetailPane>` tag).
Child root = `data-testid="skill-catalog-detail-pane"`.
- **props:** `entry` (name/description/alreadyActive), `sourceMeta`, `actioningKey`,
  `selectedKey`, `loading`, `error`, `detail`.
- **emits:** `star` (payload = entry).
- **Markdown ownership moves into the child**: the child calls
  `useSkillMarkdown(() => props.detail?.body)` and owns the `v-html` + mermaid ref.
  The now-dead `catalogRenderedBody` / `catalogMarkdownRef` are removed from
  `useSkillCatalog` (they were view-only refs, untested — a detail pane owning its own
  body rendering is the cleaner design). The active-skill body pane keeps the
  parent-level `useSkillMarkdown` (unchanged) — it is deferred, not extracted.

## Deferred (with reasons)

- **`SkillDetailPane.vue` (active detail):** carries the flipping
  `isSelectedPreset ? 'skill-unstar-btn' : 'skill-delete-btn'` testid, two-way edit
  state (`editDescription`/`editBody` v-models), the `skillMarkdownRef`, and 4 action
  emits. Provable but the highest-risk subtree; a separate PR under e2e cover.
- **`SkillCatalogList.vue` / `SkillRepoGroup.vue` / `SkillActiveList.vue`:** carry the
  `skill-catalog-item-${entryKey(entry)}` / `skill-item-${name}` dynamic testids and
  heavy selection coupling. Byte-equivalence is provable (import `entryKey` into the
  child, same expression) but the surface is larger; kept out of this PR so the change
  stays to the two off-hot-path panes.

## Proof of byte-equivalence

- `git diff` the pre/post rendered structure by inspecting the template deltas: the
  extracted markup is moved verbatim, only `t(...)`/state references rebind to
  `props`/`emit`.
- Run `e2e/tests/skills.spec.ts` (mock, `yarn test:e2e`) — must stay green. It exercises
  the add-repo modal (open, suggestion prefill, install, uninstall) and the catalog
  detail pane (select external entry → detail → star).

## Verify (all must pass)

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`, skills e2e.
No version bumps.
