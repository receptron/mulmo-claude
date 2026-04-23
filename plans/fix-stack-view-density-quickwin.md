# plan: Stack View density — shared CSS quick-win (A)

Tracking: #709 (phase A). Umbrella for per-plugin refactor: #708 (phase B).

## Goal

Claim back vertical space on Stack view without touching plugin
structure. Pure CSS padding / gap reduction. Per-plugin header
refactors (overflow menus, hover actions) are deferred to #708.

## Non-goals

- Removing any button or action.
- Restructuring header layout (wiki tabs, MulmoScript Characters,
  etc.).
- Changing canvas (right-pane) density.
- Touching i18n.

## Changes

### 1. `src/components/StackView.vue`

- Outer wrapper: `p-4 space-y-3` → `p-3 space-y-2`.
- Per-card header strip: `px-3 py-2` → `px-3 py-1.5`.

### 2. Per-plugin header padding (unify to `py-2.5`)

All plugin Views whose top-level header strip currently uses `py-4`
or `py-3`. Where a plugin has a secondary bar (tabs, filter), tighten
that from `py-2` to `py-1.5`.

Files:

- `src/plugins/wiki/View.vue` (header `py-4 px-6` → `py-2.5 px-6`; tab row `py-2` → `py-1.5`)
- `src/plugins/markdown/View.vue` (header `py-2 px-4` → `py-1.5 px-4`; bottom bar `py-2` → `py-1.5`)
- `src/plugins/presentHtml/View.vue` (header `py-2 px-4` → `py-1.5 px-4`)
- `src/plugins/chart/View.vue` (header `py-2 px-4` → `py-1.5 px-4`)
- `src/plugins/spreadsheet/View.vue` (header `py-4` → `py-2.5`)
- `src/plugins/presentMulmoScript/View.vue` (header `py-4 px-6` → `py-2.5 px-6`; beat row `py-3` → `py-2`)
- `src/plugins/todo/View.vue` (header `py-4 px-6` → `py-2.5 px-6`; filter bar `py-2` → `py-1.5`)

Padding changes only. No HTML/DOM restructure.

## Expected

- ~12–20 px saved per card header
- ~4 px saved in the between-card gap
- Over 5 cards: ~80–120 px → roughly one extra card visible per screen

## Testing

### Automated

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` clean.
- Existing e2e suite still passes (none of these files are a11y-tested at the CSS padding level).

### Manual (reviewer checklist)

- Open Stack view with a mixed session (MulmoScript + wiki + chart + markdown stacked).
- Confirm visible content-per-screen increases vs. current main.
- Confirm no content clipping, no layout jumps, buttons still easy to hit.
- Focus-visible rings still fit inside padding boxes (no ring truncation).

## Files to touch

- `src/components/StackView.vue`
- `src/plugins/{wiki,markdown,presentHtml,chart,spreadsheet,presentMulmoScript,todo}/View.vue`
- `plans/fix-stack-view-density-quickwin.md` (this file)

## Done when

- All plugin Views listed have their header / secondary-bar padding tightened.
- CI green.
- PR merged.

Then: start #708 with `presentMulmoScript` as the first per-plugin
refactor.
