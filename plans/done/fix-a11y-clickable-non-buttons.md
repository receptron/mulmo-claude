# plan: accessible clickable non-button elements

Tracking: #684

## Goal

Every `@click=`-bearing `<div>` / `<span>` / `<li>` / `<th>` / `<td>`
in `src/**/*.vue` either:

- is converted to a `<button>`, or
- follows the "clickable region" contract: `tabindex="0"`,
  `role="button"`, keyboard activation (Enter + Space), an
  `aria-label`, and a visible `cursor-pointer`.

So keyboard and screen-reader users can operate the same affordances
mouse users already can.

## Audit (9 sites)

Result of grepping `@click=` and excluding `<button>` / anchors:

### Intentionally kept non-interactive (3) — visual backdrops

These dismiss a modal / popup when clicked. They are not primary
actions — the primary dismissals are the explicit close button or
Escape key. Making the backdrop itself focusable would add a bogus
tab stop.

- `src/components/SettingsModal.vue:2` — modal backdrop
- `src/components/ChatInput.vue:63` — expanded-editor backdrop (uses `@click.self`)
- `src/components/TodoExplorer.vue:130` — add-column popover backdrop

Leave as-is. Out of scope for #684. Broader a11y pass (Escape-to-close
across modals) is a separate concern.

### Already a11y-complete (1)

- `src/components/NotificationBell.vue:113-119` — has `role="button"`,
  `tabindex="0"`, `@keydown.enter`, `aria-label`, `cursor-pointer`.
  Missing Space-key activation but close enough; add Space in the
  same pass for consistency.

### Needs work (5)

| # | Site | Action |
|---|---|---|
| 1 | `src/components/SessionHistoryPanel.vue:41` | Session row. Complex nested layout — use clickable-region pattern |
| 2 | `src/components/todo/TodoListView.vue:6` | List row toggle-expand. Clickable-region pattern |
| 3 | `src/components/todo/TodoTableView.vue:7` | Sortable `<th>`. Clickable-region + `aria-sort` state |
| 4 | `src/components/todo/TodoTableView.vue:20` | Expandable `<td>`. Clickable-region |
| 5 | `src/components/todo/TodoKanbanView.vue:68` | Kanban card click. Clickable-region |

Plus the one-line Space-key addition to `NotificationBell.vue:113-119`.

## Design — clickable-region pattern

Template contract applied per site:

```vue
<div
  tabindex="0"
  role="button"
  :aria-label="..."          <!-- describes the action -->
  class="cursor-pointer ..."
  @click="handleActivate"
  @keydown.enter.prevent="handleActivate"
  @keydown.space.prevent="handleActivate"
>
```

### Why both Enter and Space?

Native `<button>` fires `click` on both Enter AND Space. Real keyboard
users will try Space on a `role="button"` element and expect it to
work. NotificationBell currently only wires Enter; the update below
includes Space.

### Why `.prevent` on Space?

`Space` default behaviour on focusable elements scrolls the page.
`.prevent` suppresses the scroll so the key acts only as activation.

### No shared helper

Five sites with a five-attribute template pattern doesn't justify a
composable. Inline duplication is easier to read and each site's
`aria-label` / handler is unique anyway. If the sixth case appears,
revisit.

## i18n

Every new `aria-label` string is added to `src/lang/*.ts` under a
logical namespace (e.g., `sessionHistoryPanel.sessionRowAria`,
`todoListView.rowToggleAria`, `todoTableView.sortColumnAria`,
`todoTableView.expandRowAria`, `todoKanbanView.openCardAria`). Adds
into all 8 locales in one pass per the project rule.

Strings are short and imperative ("Open session {title}", "Toggle
{task}", "Sort by {column}", "Expand {task}", "Open card {title}").

## Testing

### E2E — keyboard regression guard

Add one new spec `e2e/tests/a11y-clickable-rows.spec.ts` that Tab-focuses
the session-history row and presses Enter → confirms navigation to
`/chat/<id>`. Picks the most user-visible of the five sites. Mirrors
the pattern of the existing `router-navigation` spec.

### Unit

No new unit test — the changes are pure template a11y attributes.
`vue-tsc` catches typos on bound `aria-label` expressions.

## Files to touch

- `src/components/SessionHistoryPanel.vue`
- `src/components/todo/TodoListView.vue`
- `src/components/todo/TodoTableView.vue`
- `src/components/todo/TodoKanbanView.vue`
- `src/components/NotificationBell.vue` (Space-key addition)
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` (new aria-label strings, 8 files)
- `e2e/tests/a11y-clickable-rows.spec.ts` (new)
- `plans/done/fix-a11y-clickable-non-buttons.md` (this file)

## Done when

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` clean
- `yarn test:e2e a11y-clickable-rows` green
- Manual keyboard smoke: Tab through the 5 updated sites, Enter/Space
  activates each (matches mouse click behaviour)
- PR merged

## Out of scope

- Backdrop-dismiss a11y (Escape key audit across modals) — separate
  concern, can be its own issue if deemed worth tracking.
- `role="button"` on every icon link or similar — this issue is
  scoped to the 5 concrete offending sites identified in the audit.
- Full a11y audit (focus rings, aria-live, contrast, etc.).
