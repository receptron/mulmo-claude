# feat: Stack mode without sidebar (#498)

## Problem

Stack mode's canvas already shows every tool result chronologically — the
same data that `ToolResultsPanel` previews in the left sidebar. The sidebar
therefore duplicates content and compresses the Stack view into ~70% of
the window width.

The goal is a Stack-only layout with no left sidebar, controls split
between a top bar and a bottom bar, and the canvas at full width.

Prep work (#497) has already extracted the 5 sidebar regions
(`SidebarHeader`, `RoleSelector`, `SessionTabBar`, `SuggestionsPanel`,
`ChatInput`) into standalone components, so this change is pure layout
movement — no component rewrites.

## Target layout (Stack mode only)

```text
┌──────────────────────────────────────────────────────────┐
│ MulmoClaude │ [RoleSelector] │ [SessionTabBar] │ 🔔 🛠 ⚙ │  top bar
├──────────────────────────────────────────────────────────┤
│                                                          │
│                       StackView                          │
│                (full width, tool results)                │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [SuggestionsPanel]                                      │
│  [ChatInput]                                             │  bottom bar
└──────────────────────────────────────────────────────────┘
```

Single / Files / Todos / Scheduler / Wiki / Skills / Roles keep the
current sidebar layout unchanged.

## Decisions on open questions

1. **Gemini API key warning** → inline banner above `StackView` (same
   tone/styling as today, just re-anchored). Keeps it visible without
   crowding the top bar or stealing space from `ChatInput`.
2. **Right sidebar (tool-call history)** → unchanged. Top-bar `build`
   button still toggles `RightSidebar`, which is already an absolutely-
   positioned panel on the right edge — it works identically under both
   layouts.
3. **Mode-switch transition** → hard cut. Matches every other view-mode
   switch today (`CanvasViewToggle` already has a visible affordance).
4. **Session history popup** → reuse the existing
   `historyPopupTopOffset` mechanism, but anchor it to the top bar's
   history button. Popup renders below the top bar, spans the full
   window width, and closes on outside click via the existing
   `useClickOutside` wiring.

## Implementation

### 1. Single-source layout switch in `src/App.vue`

Drive everything from one condition:

```ts
const isStackLayout = computed(
  () => canvasViewMode.value === CANVAS_VIEW.stack,
);
```

Two top-level branches in the template:

- `v-if="isStackLayout"` → new top bar + full-width canvas + bottom bar
- `v-else` → existing sidebar + canvas layout (unchanged)

No component props or logic change — only placement and container classes.

### 2. New top bar (Stack layout)

A single horizontal row containing:

- `SidebarHeader` — already has a flex row; title on the left, lock /
  notification / build / settings buttons on the right. Extract those
  action buttons into their own row-friendly slot or drop the title's
  `border-b` / `p-4` padding for top-bar use. Pass the existing props
  (`sandboxEnabled`, `showRightSidebar`, `titleStyle`) and emit events
  the same way.
- `RoleSelector` — `p-4 border-b` needs trimming for the top-bar row;
  the component's dropdown is `absolute left-4 right-4 top-full` which
  still works when the selector sits in a narrower container. Cap its
  width (e.g. `w-64`) so it doesn't push the session tabs off-screen.
- `SessionTabBar` — already horizontal. Drop the bottom border and
  `px-2 py-1` surround, let the top bar own spacing.

**History popup**: move `<SessionHistoryPanel>` out of the left-sidebar
container and render it as a top-bar-anchored popup. Its current
positioning uses `absolute left-0 right-0 top: ${offset}px` — keep
that, just compute `historyPopupTopOffset` from the top-bar's height
(e.g. `sessionTabBarRef.value?.historyButton?.getBoundingClientRect()
.bottom`).

Each sub-component may need a small prop or `:class` tweak for the
"top-bar variant" — prefer passing a `variant: 'sidebar' | 'topbar'`
prop over duplicating components. If the style delta is tiny (just
drop borders/padding), a parent-applied wrapper class is enough.

### 3. Full-width canvas

Drop the `w-80` sidebar column. The canvas wrapper becomes the single
flex child:

```html
<div class="flex-1 flex flex-col bg-white text-gray-900 min-w-0 overflow-hidden">
  <!-- Gemini warning banner (Stack only) -->
  <!-- PluginLauncher + CanvasViewToggle row (existing) -->
  <!-- StackView (canvasRef) -->
</div>
```

`StackView` already fills its parent — no changes needed inside it.

### 4. Bottom bar

`SuggestionsPanel` + `ChatInput` stacked vertically, pinned to the
bottom via `flex-shrink-0`. Both components already define their own
padding and borders — keep them as-is, just host them in a shared
container directly under the canvas wrapper.

`suggestionsPanelRef.collapse()` (called from `createNewSession`)
continues to work unchanged.

### 5. Things to remove from the Stack layout

- `ToolResultsPanel` — not rendered in Stack mode. Keep the
  `toolResultsPanelRef` ref (used by `chatListRef` / `scrollChatToBottom`)
  but make `scrollChatToBottom` no-op when `isStackLayout` is true;
  `StackView` auto-scrolls to newly-selected results already via its
  internal `scrollToItem`.
- Sidebar key navigation (`handleKeyNavigation` with
  `activePane === 'sidebar'`) — harmless because `activePane` defaults
  to `'sidebar'` but no sidebar list exists to navigate. The canvas's
  own `handleCanvasKeydown` takes over in Stack layout. Consider
  defaulting `activePane` to `'main'` when entering Stack mode.

### 6. Per-session persistence

No new state. The layout is purely derived from `canvasViewMode`, which
is already per-session via the route query string. Switching view modes
toggles the layout automatically; loading a pre-existing session with
`?view=stack` lands directly in the new layout.

## Files touched

| File | Change |
|---|---|
| `src/App.vue` | Two-branch template; add `isStackLayout` computed; move `SessionHistoryPanel` anchor; no-op `scrollChatToBottom` in Stack; set `activePane='main'` when entering Stack |
| `src/components/SidebarHeader.vue` | Optional `variant` prop to drop title padding in top-bar mode, OR split the action buttons into a small `HeaderActions.vue` so the top bar can compose title + actions separately |
| `src/components/RoleSelector.vue` | Accept `variant` / compact styling; cap dropdown width when in top bar |
| `src/components/SessionTabBar.vue` | Accept `variant` / drop border + surround when in top bar |
| `src/components/SessionHistoryPanel.vue` | No logic change; verify full-width popup looks right when anchored to top bar |

No server-side changes. No new API routes. No new event types.

## Testing

### E2E (`e2e/`)

- `stack-layout.spec.ts` (new):
  - Switch to Stack mode → sidebar gone; top bar contains role selector,
    session tabs, lock/notification/settings buttons.
  - Suggestions + chat input sit at the bottom of the viewport.
  - Click history button in top bar → popup opens below the top bar.
  - Type in chat input → message appears; new tool result renders
    full-width in the stack.
  - Switch back to Single mode → sidebar reappears; top bar gone.
- Update any existing Stack-mode test that selects by
  `[data-testid="tool-results-panel"]` — those selectors don't exist
  in the new layout.

Use `mockAllApis(page)` before `page.goto()`. All existing fixtures
in `e2e/fixtures/chat.ts` (role switch, send message, wait for result)
must continue to work for Single mode and be adjusted where they
assume a left-sidebar position.

### Manual testing

- Gemini-warning visibility when role needs it and the key is missing
  (Stack + Single mode).
- Notification / settings / lock popups open from the top bar without
  overlapping the stack canvas.
- Right sidebar toggle works in Stack mode (covers canvas from the
  right edge).
- Session tab overflow: 6 active sessions + history button fit in
  the top bar without clipping on 1280px-wide windows.
- Mode switch Single ⇄ Stack preserves `selectedResultUuid` and
  session state.

### Typecheck / lint / build

- `yarn format && yarn lint && yarn typecheck && yarn build` after
  changes.

## Out of scope

- Changing Single / Files / Todos / Scheduler / Wiki / Skills / Roles
  layouts.
- Mobile / narrow-window responsive handling (follow-up if needed).
- Animated transitions between layouts (hard cut chosen above).
- Restructuring `StackView` itself.
