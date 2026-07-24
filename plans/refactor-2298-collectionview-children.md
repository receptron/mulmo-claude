# refactor(#2298): CollectionView.vue — template → child components

Third step on #2298. The two earlier PRs stayed inside `<script setup>`:

- #2384 — pure helpers + click-outside dedup (safe layer)
- #2455 — `useRelatedMenu` / `useTableSort` composables (template untouched)

This step starts the **template → child-component** split that #2298 primarily
asks for.

## Hard constraint

`CollectionView.vue` carries **51 `data-testid`s — the most of any SFC**, and
#2298 flags structural traps (`collection-image-field.spec.ts` depends on the
`<thead><th>` hierarchy; `collections-row-<id>` is depended on by 6 specs).

A subtree may move into a child **only if the child renders byte-equivalent
DOM**: single root element matching the original wrapper, same
attributes/classes/`data-testid`s, dynamic testids passed through as props and
rendered identically.

Favourable fact: this SFC has **no `<style scoped>`**, so moving a subtree does
not shift any scoped-style hash.

Two mechanical rules that keep the output byte-identical:

- The parent passes **no `class`/`style`** to a child, so nothing falls through
  and merges into (and reorders) the child root's own class string.
- Every handler is a **declared `emit`**, so it never lands on the root as a
  native DOM listener.

## Candidates considered

| Subtree | Lines | Verdict |
|---|---|---|
| Chat modal (874–939) | 64 | **DONE** — `CollectionChatModal.vue` |
| Repair banner (426–446) | 21 | **DONE** — `CollectionRepairBanner.vue` |
| Header (3–188) | 186 | **Deferred** — see below |
| Search toolbar (202–424) | 223 | **Deferred** — see below |
| Table + cell (603–817) | 215 | **Deferred** — see below |
| Refresh note (190–200) | 11 | Skipped — a bare message `<div>`; a component adds a prop and buys nothing |
| Inline-error banner (539–554 / 607–622) | 2×16 | **Deferred** — see below |

### Chosen for this PR (both provably byte-equivalent)

**`CollectionChatModal.vue`** — self-contained overlay. The child owns the
draft (`message`) and the textarea ref: the parent's `v-if` remounts it on every
open, so it starts blank and self-focuses (`onMounted`), replacing the parent's
`chatMessage = ""` + `nextTick(focus)`. It emits `submit` with the raw text; the
parent still trims and builds the seed, so `/​<slug> <message>` is unchanged.
Fully covered by `collection-chat-button.spec.ts`.

**`CollectionRepairBanner.vue`** — static banner + one button. Props: `count`.
Emits: `repair`. No dynamic testid, no logic.

### Deferred, with the specific trap each hits

- **Header** — its `v-if` branches (`collections-refresh-feed`,
  `collections-delete`, `feeds-delete`, `collections-action-<id>`,
  `collections-readonly-*`) are referenced by **no e2e spec**, so a ~13-prop /
  ~7-emit rewiring could not be *proved*, only reviewed. It also drags
  `useRelatedMenu` into the child, because a `ref` used by `useClickOutside`
  cannot cross a component boundary.
- **Search toolbar** — same click-outside problem twice over (`filterMenuRef`
  **and** `addMenuRef`), plus the `v-model="searchQuery"` two-way binding.
- **Table + cell** — the highest-risk subtree in the repo: the
  `<table>/<thead>/<th>` hierarchy `collection-image-field.spec.ts:71`
  traverses, and `collections-row-<id>` which must stay on the root `<tr>`
  (a wrapper `<div>` would shift `nth()` / `toBeInViewport`). Deserves a
  dedicated PR.
- **Inline-error banner** — the natural dedup (it is copy-pasted twice) would
  have to parameterise the wrapper margin (`m-4` vs `m-3 mb-0`). Passing a
  `class` from the parent makes Vue *merge and reorder* the class string, so the
  rendered `class` attribute would no longer be byte-identical. Not worth it.

## Verification

- `yarn format`, `yarn lint` (0 errors), `yarn typecheck`, `yarn build`, unit
  tests — all green. No version bumps.
- **Collection mock e2e, baseline-vs-change**: all 18 collection spec files
  (`collection-*.spec.ts` + `present-collection.spec.ts`), **73 tests**.
  Baseline (`origin/main`'s CollectionView) **73/73**; with the extraction
  **73/73**.

### Run e2e on a private port when several worktrees are active

`e2e/playwright.config.ts` pins port **45173** with
**`reuseExistingServer: true`**. With more than one agent worktree active, a
`yarn test:e2e` run can attach to *another worktree's* dev server and exercise
code that isn't yours — which makes green and red runs equally meaningless. An
early run here failed 32/50 across specs the change cannot touch (calendar,
flag-filter), purely from that.

Verify with a throwaway config that takes a private port and
`reuseExistingServer: false`, so Playwright boots a server from *this*
worktree. Both numbers above were produced that way; the plugin must be
rebuilt first, because the host imports `@mulmoclaude/collection-plugin/vue`
from `dist/`, not from source.

## Result

`CollectionView.vue` **2736 → 2651** lines (−85).
