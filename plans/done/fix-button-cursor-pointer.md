# plan: restore default `cursor: pointer` on buttons (Tailwind v4 regression)

Tracking: #680

## Goal

Every `<button>` in the app feels clickable again. Hovering over a
button shows the pointer cursor — the behaviour users expected before
the Tailwind v3 → v4 migration.

## Root cause

Tailwind CSS v4 removed the implicit `cursor: pointer` on `<button>`
from its preflight ([upgrade guide][1]). The repo migrated to v4 via
`@import "tailwindcss";` in `src/index.css` but never added a global
backfill, so all ~153 `<button>` tags in `src/` render with the
browser default (`cursor: default`). None of them carry a
`cursor-pointer` class today.

[1]: https://tailwindcss.com/docs/upgrade-guide#buttons-use-the-default-cursor

## Design — single-rule global fix

Add one CSS rule to `src/index.css` under a new `@layer base` block:

```css
@layer base {
  /* Tailwind v4 removed the default `cursor: pointer` on buttons.
     Restore it globally so every <button> feels clickable without
     sprinkling `cursor-pointer` across 150+ sites. Disabled buttons
     keep their non-pointer cursor; specific call sites can still
     override via Tailwind utilities (cursor-wait, cursor-not-allowed)
     because they load later in the cascade. */
  button:not(:disabled) {
    cursor: pointer;
  }
}
```

### Why global, not per-component

- **Scale**: 153 buttons across 40+ files. Per-component changes mean a
  huge diff, heavy review, and guaranteed "add `cursor-pointer` on the
  next new button" drift.
- **Discoverability**: future contributors don't know about the v4
  preflight change; one rule in `index.css` is easier to reason about
  than a convention document.
- **Override-friendly**: Tailwind utility classes and `:disabled:`
  variants still win (specificity is equal; later declarations win).

### Why `@layer base`

Keeps the rule in Tailwind's base layer so utility classes (normal
layer) and component-level classes still override cleanly.

### Why `:not(:disabled)`

Preserves the native disabled look. Sites that want
`cursor: not-allowed` on disabled state (e.g. via the Tailwind
`disabled:` variant) continue to work unchanged.

## Scope

**In scope:**
- `src/index.css` — +4 lines inside a new `@layer base { … }` block.

**Out of scope:**
- Clickable `<div>` / `<span>` / `<li>` with `@click=` handlers
  (14 sites, ~3 already carry `cursor-pointer`). These need per-site
  judgement and accessibility work (`role="button"`, keyboard
  activation). Handle in a follow-up.
- Focus ring, hover-state audit, broader a11y review.

## Testing

### Manual

1. `yarn dev`, open the app, hover a button on each major view:
   - Sidebar header (settings / history / tool-call history buttons)
   - Chat input send button
   - Session tab bar
   - Plugin launcher
   - Settings modal tabs and save buttons
   - Canvas view toggle
   - At least one plugin View (e.g., Scheduler View, TodoExplorer)
   → every button shows the pointer cursor.
2. Hover a `disabled` button (e.g., Settings save while "cannot save"
   tooltip applies) → cursor stays non-pointer.
3. Hover a button that sets `cursor-wait` mid-operation → still wait.

### Automated

Existing E2E and unit suites exercise click interactions but not the
CSS `cursor` property; there is no easy assertion here short of a
visual regression test. We skip automated coverage and rely on manual
verification + the simplicity of the single rule.

## Files to touch

- `src/index.css` — 1 new block.

## Done when

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` clean.
- Manual smoke across the main views shows pointer cursor on buttons,
  disabled stays non-pointer.
- PR merged.
