# plan: Stack View compact plugin headers + hoisted actions

Tracking: #711 (this PR). Umbrella: #708.
Replaces closed phase A: #709 / #710.

## Goal

Eliminate the "double header" on stacked cards. The plugin's own
title/action row disappears in stack mode; primary actions (PDF,
Edit) ride along in StackView's existing per-card header via
`<Teleport>` into a stable per-card target div.

## Non-goals

- Single view — zero visible change.
- Per-chart PNG export consolidation (`chart`), movie download
  (`presentMulmoScript`), filter bar layout (`todo`), spreadsheet
  custom CSS — all deferred to follow-up children of #708.
- i18n — no new strings; reuse existing PDF / Show-Source labels.

## Contract

### Plugin View props (added, both optional)

```ts
defineProps<{
  selectedResult: ToolResult<…>;
  compact?: boolean;
  stackActionsTarget?: string;
}>();
```

- `compact === true` → plugin suppresses its own header strip.
- `stackActionsTarget` is an element id StackView guarantees exists
  in the DOM by the time the plugin mounts. Plugin uses it for
  `<Teleport :to="`#${stackActionsTarget}`">`.

### StackView

Per card it renders a target div with the stable id
`stack-actions-${result.uuid}` inside its existing header strip:

```vue
<button class="w-full flex items-center gap-2 px-3 py-2 border-b ...">
  <span class="material-icons">{{ iconFor(result.toolName) }}</span>
  <span class="truncate">{{ result.title || result.toolName }}</span>
  <div :id="`stack-actions-${result.uuid}`" class="ml-auto flex items-center gap-1" @click.stop></div>
  <span class="text-[10px] text-gray-400">{{ formatSmartTime(...) }}</span>
  <span class="font-mono text-xs">{{ result.toolName }}</span>
</button>
```

Passes both new props to every `<component :is="plugin.viewComponent">`
invocation:

```vue
<component
  :is="…"
  :selected-result="result"
  :compact="true"
  :stack-actions-target="`stack-actions-${result.uuid}`"
  ...
/>
```

`@click.stop` on the target div stops a button click from bubbling
up and triggering `emit('select', ...)` on the card-header button.

### Target plugins (this PR)

1. **markdown** — hide the `.flex justify-end px-4 py-2` header in
   compact; teleport `PDF` button only (bottom-bar Edit/Source stays
   since it's already collapsed inside `<details>`).
2. **wiki** — hide the `px-6 py-4` header in compact on **page view
   only** (action === "page"). Index / log / lint-report views keep
   their navigational tabs since those ARE the primary content affordance.
   Teleport the `PDF` button.
3. **presentHtml** — hide the `px-4 py-2` header; teleport `PDF` + `Show Source`.

## Risk / edge cases

- **Teleport target race**: target div is a sibling of the `<component>`
  in the same template, so it's in the DOM before the plugin's
  `onMounted` fires. Verified pattern.
- **Card-header click bubble**: the card header `<button>` emits
  `select(uuid)` on click. Teleported action buttons inside that
  button would bubble up; `@click.stop` on the teleport target div
  contains that.
- **Non-stack callers** (`<component :is="plugin" />` in App.vue Single
  mode, in tests, elsewhere): don't pass `compact` → undefined →
  falsy → existing behavior preserved.
- **Empty teleport target**: when a plugin has nothing to hoist
  (or compact is false), the target div renders but stays empty.
  Harmless — no visual impact with `class="ml-auto flex items-center gap-1"`
  on an empty element.

## Testing

### Automated

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` clean.
- Existing e2e suite passes (no specs target the plugin header
  structure directly).
- Add one e2e spec `e2e/tests/stack-compact-actions.spec.ts` that:
  - Loads a stack view with a markdown result in fixtures.
  - Asserts the plugin's own header is NOT present.
  - Asserts the PDF button IS present in the card header strip.

### Manual

- Open `/chat` in stack mode with markdown + wiki page + presentHtml results → confirm:
  - Single unified header per card.
  - PDF buttons sit in the card header next to the tool name.
  - Clicking PDF triggers download (not card-select).
  - Switching to single mode shows each plugin's original header back.

## Files to touch

- `src/components/StackView.vue` — target div + pass props.
- `src/plugins/markdown/View.vue` — `compact` + Teleport + conditional header.
- `src/plugins/wiki/View.vue` — same, page-view only.
- `src/plugins/presentHtml/View.vue` — same.
- `e2e/tests/stack-compact-actions.spec.ts` — new spec.
- `plans/feat-stack-compact-actions.md` — this file.

## Done when

- The three target plugins in stack mode render only one header strip.
- Primary actions still reachable from the compact header.
- Single view is unchanged.
- CI green.
- PR merged. Remaining plugins (chart / MulmoScript / todo / spreadsheet) get their own follow-up children of #708.
