# Refactor: split `src/App.vue`

## Goal

`src/App.vue` has grown to **1329 lines** (448 template + 880 script + ~70 top-level declarations). It mixes:

- per-session runtime state and the SSE event loop
- role management
- canvas view mode
- MCP tool status
- pending tool-call timing
- keyboard navigation
- popup outside-click handlers
- the entire sidebar template
- the canvas + right sidebar template

This refactor extracts the script-side concerns into composables and the template-side chunks into child components. **The goal is purely organizational — no behavior changes.**

## Non-goals

- No new features
- No bug fixes (other than ones that fall out of the structural split itself)
- No new dependencies
- No changes to the server or to other components beyond what's needed to resolve imports
- No changes to `localStorage` keys, route paths, or external contracts

## Constraints

- All existing PRs (#94 chat-index, etc.) must remain mergeable. Conflicts on App.vue are inevitable but should be **mechanical** to resolve — the new locations of moved code must be obvious.
- Each phase must leave the app **runnable** — i.e. each phase commits a valid intermediate state, not a half-finished extraction.
- Tests (`yarn test`) must keep passing.
- Lint / typecheck / build must keep passing.
- Public template bindings keep their names (`isRunning`, `toolResults`, etc.) so the template diff is minimal.

---

## Current structure (baseline)

### Top-level state

```text
sessionMap, currentSessionId, activeSession, toolResults, isRunning,
statusMessage, toolCallHistory, selectedResultUuid, activeSessionCount,
unreadCount, mergedSessions, tabSessions, sessions, showHistory,
roles, currentRoleId, currentRole, userInput, activePane,
geminiAvailable, sandboxEnabled, showLockPopup,
chatListRef, canvasRef, textareaRef, historyButtonRef, historyPopupRef,
lockButtonRef, lockPopupRef, headerRef, roleButtonRef, roleDropdownRef,
showRoleDropdown, showRightSidebar, canvasViewMode, filesRefreshToken,
rightSidebarRef, disabledMcpTools, mcpToolDescriptions, availableTools,
displayTick, tickInterval, pendingCalls, toolDescriptions,
selectedResult, queriesHidden, showQueries, sandboxTestQueries
```

### Top-level functions

```text
scrollChatToBottom, loadStoredViewMode, setCanvasViewMode,
findScrollableChild, handleCanvasKeydown, handleViewModeShortcut,
handleKeyNavigation, roleIcon, roleName, formatDate,
extractImageData, makeTextResult, pushErrorMessage, handleUpdateResult,
onSidebarItemClick, toggleRightSidebar, createNewSession, onRoleChange,
isUserTextResponse, refreshRoles, fetchHealth, fetchMcpToolsStatus,
fetchSessions, toggleHistory, loadSession, sendMessage,
handleClickOutsideHistory, handleClickOutsideLock, handleClickOutsideRoleDropdown,
tabColor
```

---

## Target file layout

```text
src/
├── App.vue                          (~400 lines: template + glue)
├── types/
│   ├── session.ts                   (SessionSummary, SessionEntry, ActiveSession, type guards)
│   └── sse.ts                       (SseToolCall ... SseEvent union)
├── composables/
│   ├── useSessions.ts               (session map, sendMessage, loadSession, ...)
│   ├── useRoles.ts                  (roles, currentRoleId, refreshRoles, helpers)
│   ├── useCanvasViewMode.ts         (single/stack/files toggle + shortcuts)
│   ├── useMcpTools.ts               (disabled tools, descriptions, fetch)
│   ├── usePendingCalls.ts           (PENDING_MIN_MS bookkeeping)
│   ├── useKeyboardNav.ts            (sidebar + canvas arrow handling)
│   └── useClickOutside.ts           (small helper for popup dismiss)
└── components/                      (existing dir, new entries below)
    ├── SidebarHeader.vue            (NEW: top buttons + badges)
    ├── SessionHistoryPopup.vue      (NEW: history list popup)
    ├── RoleDropdown.vue             (NEW: role select dropdown)
    ├── ChatComposer.vue             (NEW: sample queries + textarea + send)
    └── ToolResultList.vue           (NEW: sidebar tool result list)
```

---

## Phase A — script-side extraction (composables + types)

**Outcome**: `App.vue` script body shrinks from ~880 to ~150 lines. Template untouched. No behavior change. Verified by `yarn test && yarn build`.

### A.1 — `src/types/sse.ts` *(new)*

Move from App.vue:

```ts
SseToolCall, SseToolCallResult, SseStatus, SseSwitchRole,
SseText, SseToolResult, SseRolesUpdated, SseError, SseEvent
```

App.vue imports them.

### A.2 — `src/types/session.ts` *(new)*

Move from App.vue:

```ts
SessionSummary
SessionEntry, TextEntry, ToolResultEntry  (+ isTextEntry, isToolResultEntry guards)
ActiveSession
```

### A.3 — `src/composables/usePendingCalls.ts` *(new)*

Encapsulates the "minimum visible duration" trick for pending tool calls so a freshly resolved tool doesn't flicker:

```ts
export function usePendingCalls(opts: {
  isRunning: ComputedRef<boolean>;
  toolCallHistory: ComputedRef<ToolCallHistoryItem[]>;
}) {
  const PENDING_MIN_MS = 500;
  const displayTick = ref(0);
  let tickInterval: ReturnType<typeof setInterval> | null = null;

  watch(opts.isRunning, (running) => { /* ... */ });

  const pendingCalls = computed(() => { /* ... */ });

  function teardown() {
    if (tickInterval !== null) clearInterval(tickInterval);
  }

  return { pendingCalls, teardown };
}
```

### A.4 — `src/composables/useCanvasViewMode.ts` *(new)*

```ts
export function useCanvasViewMode() {
  // localStorage-backed view mode (single / stack / files)
  // setCanvasViewMode, filesRefreshToken
  // handleViewModeShortcut (Cmd/Ctrl + 1/2/3)
  // returns { canvasViewMode, setCanvasViewMode, filesRefreshToken,
  //           bindShortcuts, unbindShortcuts }
}
```

### A.5 — `src/composables/useMcpTools.ts` *(new)*

```ts
export function useMcpTools(currentRole: ComputedRef<Role>) {
  // disabledMcpTools, mcpToolDescriptions
  // availableTools (filtered by disabled set)
  // toolDescriptions
  // fetchMcpToolsStatus
}
```

### A.6 — `src/composables/useRoles.ts` *(new)*

```ts
export function useRoles() {
  // roles, currentRoleId, currentRole
  // refreshRoles, roleIcon, roleName
  // returns the refs + helpers
}
```

### A.7 — `src/composables/useSessions.ts` *(new, the big one)*

The chunk that hurts most. Holds:

- `sessionMap`, `currentSessionId`, `activeSession`
- All proxy computeds: `toolResults`, `isRunning`, `statusMessage`, `toolCallHistory`, `selectedResultUuid`, `activeSessionCount`, `unreadCount`
- `mergedSessions`, `tabSessions`, `tabColor`
- `sessions` (server-loaded list), `fetchSessions`
- `createNewSession`, `loadSession`, `sendMessage` (and inner SSE loop), `pushErrorMessage`, `makeTextResult`, `isUserTextResponse`, `handleUpdateResult`, `extractImageData`
- the `watch(currentSessionId, …)` that clears `hasUnread`

The composable receives external dependencies (roles, getPlugin, disabled MCP tools) as parameters so it stays a pure module:

```ts
export function useSessions(opts: {
  rolesRef: Ref<Role[]>;
  currentRoleId: Ref<string>;
  currentRole: ComputedRef<Role>;
  refreshRoles: () => Promise<void>;
}) {
  // ... ~350 lines of session logic ...
  return {
    sessionMap, currentSessionId, activeSession,
    toolResults, isRunning, statusMessage, toolCallHistory,
    selectedResultUuid, activeSessionCount, unreadCount,
    mergedSessions, tabSessions, tabColor, sessions,
    fetchSessions, createNewSession, loadSession, sendMessage,
    pushErrorMessage, handleUpdateResult, onRoleChange,
  };
}
```

### A.8 — `src/composables/useKeyboardNav.ts` *(new)*

```ts
export function useKeyboardNav(opts: {
  activePane: Ref<"sidebar" | "main">;
  chatListRef: Ref<HTMLDivElement | null>;
  canvasRef: Ref<HTMLDivElement | null>;
  toolResults: ComputedRef<ToolResultComplete[]>;
  selectedResultUuid: WritableComputedRef<string | null>;
}) {
  // findScrollableChild, handleCanvasKeydown, handleKeyNavigation
  // returns the handlers; App.vue still installs them on the right elements
}
```

### A.9 — `src/composables/useClickOutside.ts` *(new)*

Small util used by 3 popups (history / lock / role dropdown):

```ts
export function useClickOutside(
  opts: {
    isOpen: Ref<boolean>;
    buttonRef: Ref<HTMLElement | null>;
    popupRef: Ref<HTMLElement | null>;
  },
): { handler: (e: MouseEvent) => void };
```

App.vue installs the handler on `mousedown` for each popup.

### A.10 — Wire it all up in App.vue

After A.1–A.9, the App.vue script body is roughly:

```ts
const { roles, currentRoleId, currentRole, refreshRoles, roleIcon, roleName } = useRoles();

const sessionApi = useSessions({ rolesRef: roles, currentRoleId, currentRole, refreshRoles });
const { /* same names */ } = sessionApi;

const { canvasViewMode, setCanvasViewMode, filesRefreshToken,
        handleViewModeShortcut } = useCanvasViewMode();

const { disabledMcpTools, mcpToolDescriptions, availableTools,
        toolDescriptions, fetchMcpToolsStatus } = useMcpTools(currentRole);

const { pendingCalls, teardown: teardownPending } =
  usePendingCalls({ isRunning, toolCallHistory });

const { handleCanvasKeydown, handleKeyNavigation } =
  useKeyboardNav({ activePane, chatListRef, canvasRef,
                   toolResults, selectedResultUuid });

const { handler: handleClickOutsideHistory } =
  useClickOutside({ isOpen: showHistory, buttonRef: historyButtonRef, popupRef: historyPopupRef });
const { handler: handleClickOutsideLock } =
  useClickOutside({ isOpen: showLockPopup, buttonRef: lockButtonRef, popupRef: lockPopupRef });
const { handler: handleClickOutsideRoleDropdown } =
  useClickOutside({ isOpen: showRoleDropdown, buttonRef: roleButtonRef, popupRef: roleDropdownRef });

// Listener wiring left in App.vue (onMounted/onUnmounted)
// Template-only refs (chatListRef, headerRef, etc.) stay here
// fetchHealth / toggleHistory / sandbox warning state stay here
```

### Verification (Phase A)

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test` all pass
- Manual smoke: send a message, switch role, switch session, history popup, file explorer, scheduler tab, view-mode shortcuts
- Diff size estimate: ~900 lines moved into new files, ~700 lines removed from App.vue (some imports/wiring added back). Net App.vue size after Phase A: **~600 lines (template 448 + script ~150)**.

---

## Phase B — template extraction (child components)

**Outcome**: `App.vue` template shrinks from ~448 to ~200 lines. Script unchanged from Phase A end-state. Still no behavior change.

### B.1 — `src/components/SessionHistoryPopup.vue` *(new)*

Encapsulates the absolutely-positioned history popup currently inside the sidebar root. Receives:

- `sessions: SessionSummary[]` (the merged list)
- `currentSessionId: string`
- `sessionMap: ReadonlyMap<string, ActiveSession>` (read-only — for `isRunning`, `hasUnread` checks)
- emits `select` (session id)

Top offset based on header height stays — pass `topOffsetPx` as a prop.

### B.2 — `src/components/RoleDropdown.vue` *(new)*

The role select dropdown popup:

- props: `roles`, `currentRoleId`
- emits `select` (role id)
- self-contained, owns its own button-positioned wrapper

### B.3 — `src/components/SidebarHeader.vue` *(new)*

The top section of the sidebar: title, new-session, history, lock, build (right sidebar toggle) buttons + the badges. Hosts `<SessionHistoryPopup>` and `<RoleDropdown>` as children OR exposes refs for App.vue to mount the popups (TBD during implementation).

Props:
- `currentRole`
- `activeSessionCount`, `unreadCount`
- `showHistory`, `showLockPopup`, `showRoleDropdown` (or own them internally)
- `geminiAvailable`, `sandboxEnabled`

Emits:
- `new-session`, `toggle-history`, `toggle-lock`, `toggle-right-sidebar`

### B.4 — `src/components/ToolResultList.vue` *(new)*

The `<div ref="chatListRef">` block that renders one card per `toolResult` plus the "thinking" indicator. Props:

- `toolResults: ToolResultComplete[]`
- `selectedResultUuid: string | null`
- `isRunning`, `statusMessage`, `pendingCalls`

Emits:
- `select` (uuid)
- exposes `chatListRef` via `defineExpose` so the keyboard nav and scroll-to-bottom helpers can still reach the underlying div

### B.5 — `src/components/ChatComposer.vue` *(new)*

The bottom of the sidebar:

- sample query buttons (when `showQueries`)
- textarea + send button
- handles disabled state via props
- emits `send` and exposes `textareaRef` via `defineExpose` for the auto-focus on `isRunning false`

### Verification (Phase B)

Same suite as Phase A, plus a closer manual UI smoke test (popups, focus behavior, scroll behavior, queries disable on running).

App.vue template after Phase B is roughly:

```vue
<template>
  <div class="flex fixed inset-0 bg-gray-900 text-white">
    <div class="w-80 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white text-gray-900 relative">
      <SidebarHeader ... />
      <ToolResultList ... ref="toolResultListRef" />
      <ChatComposer ... ref="chatComposerRef" @send="sendMessage" />
    </div>

    <div class="flex-1 flex flex-col bg-white text-gray-900 min-w-0 overflow-hidden">
      <CanvasHeaderBar ... />
      <CanvasBody ... />  <!-- existing single/stack/files switch -->
    </div>

    <RightSidebar v-if="showRightSidebar" ... />
  </div>
</template>
```

App.vue line count after Phase B: **~400 lines (template ~200 + script ~150 + boilerplate)**.

---

## Phase C — optional polish (skip unless requested)

- `processSseEvent(session, event)` extraction inside `useSessions.ts` so the SSE loop body is testable in isolation
- Move `extractImageData` and other tiny pure helpers into `src/utils/result.ts`
- Move sandboxTestQueries / sandbox warning into a `<SandboxNotice>` component
- Potentially split `useSessions.ts` further (`useSendMessage`, `useLoadSession`) — only if the file is still uncomfortable

---

## Files Changed

| Phase | File | Status | Estimated lines |
|---|---|---|---|
| A | `src/types/sse.ts` | new | ~50 |
| A | `src/types/session.ts` | new | ~80 |
| A | `src/composables/usePendingCalls.ts` | new | ~50 |
| A | `src/composables/useCanvasViewMode.ts` | new | ~50 |
| A | `src/composables/useMcpTools.ts` | new | ~40 |
| A | `src/composables/useRoles.ts` | new | ~50 |
| A | `src/composables/useSessions.ts` | new | ~350 |
| A | `src/composables/useKeyboardNav.ts` | new | ~80 |
| A | `src/composables/useClickOutside.ts` | new | ~25 |
| A | `src/App.vue` | edit | -700 |
| B | `src/components/SidebarHeader.vue` | new | ~100 |
| B | `src/components/SessionHistoryPopup.vue` | new | ~80 |
| B | `src/components/RoleDropdown.vue` | new | ~50 |
| B | `src/components/ToolResultList.vue` | new | ~80 |
| B | `src/components/ChatComposer.vue` | new | ~70 |
| B | `src/App.vue` | edit | -200 |

**Net result**: App.vue from **1329 lines → ~400 lines**. The new files are each focused and small enough to read in one screen.

---

## Risks

- **Reactivity correctness**: moving refs into a composable changes how they are wired up. Computeds and watchers must use the composable's exported refs, not local copies. Mistakes here will show as "selection doesn't update" / "state freezes" — caught by manual smoke test.
- **`watch` ordering**: existing watches (e.g. on `currentSessionId` to clear unread, on `isRunning` for various side effects) must be installed in the same order, or one watcher may run before its dependency exists. Phase A keeps the watch site in App.vue (installed against composable refs) when ordering matters.
- **Conflict surface for in-flight branches**: PR #94 (chat-index) touches `src/App.vue` slightly (history pane summary line). Phase A merges should land against the post-#94 main when possible. If #94 lands second, the conflict is mechanical (move the Phase B history popup template into the new component file).
- **`onMounted` window listeners**: many listeners are installed in `onMounted` (`roles-updated`, `keydown`, `mousedown`, `mulmo:open-scheduler-in-files`, `mulmo:load-session`, `keydown` shortcut). They stay in App.vue's `onMounted` for now and call composable handlers. Each composable also exposes a `teardown()` if it has its own intervals (e.g. `usePendingCalls.tickInterval`).
- **Template ref forwarding**: `chatListRef` and `textareaRef` are used by App.vue (focus / scroll) AND will live inside child components after Phase B. Children use `defineExpose({ root })` to forward.

---

## Test plan

Per phase:

- [ ] `yarn format` clean
- [ ] `yarn lint` 0 errors (warnings unchanged)
- [ ] `yarn typecheck` clean
- [ ] `yarn typecheck:server` clean
- [ ] `yarn build` clean
- [ ] `yarn test` 88 tests pass (no test changes expected unless we add composable tests, which is a Phase C bonus)

Manual smoke tests after Phase A:

- [ ] App boots, default role loads, sample queries render
- [ ] Send a message → SSE stream updates, status, tool result appear
- [ ] New session button creates a new session
- [ ] History popup opens, shows sessions, click loads
- [ ] Switch role from dropdown
- [ ] Switch canvas view mode via button + via Cmd/Ctrl+1/2/3
- [ ] File explorer mode loads tree, opens markdown / json / scheduler / chat-history-search results
- [ ] Stack mode scroll-spy works
- [ ] Sidebar arrow nav works, click an item works
- [ ] Right sidebar toggle works
- [ ] Concurrent multi-session (start a long task, switch session, return — unread badge fires)

Manual smoke tests after Phase B:

- All Phase A tests
- [ ] Popup positioning unchanged (history popup sits below header)
- [ ] Focus restoration (textarea auto-focus on isRunning false)
- [ ] Stop/cancel button still aborts current session

---

## Confirmed decisions (defaults — flag any you want changed)

1. **Composables, not stores (Pinia)** — keeping the refactor strictly internal to App.vue's existing patterns. Adding Pinia is a separate dependency decision that should not be entangled here.
2. **Composables receive dependencies as parameters**, not via global imports, to keep them testable. Composable→composable wiring is done in App.vue.
3. **Phase A is mergeable on its own** — even if Phase B never happens, Phase A delivers a meaningful improvement.
4. **No tests added in Phase A** — pure refactor, behavior unchanged. Composable tests can come in Phase C if useful.
5. **`SidebarHeader.vue` owns the popups** as children, not via slots. Simpler. If app-level state needs to drive them, props in / events out.
6. **Template ref forwarding via `defineExpose`** for `chatListRef` and `textareaRef` — minimum-surface approach.
7. **Phase C is optional** — skip unless the post-Phase-B App.vue still feels heavy.

## Out of scope

- Pinia / Vuex / external state management
- Vue Router (the app is single-route)
- New tests (other than the existing 88)
- Behavior changes (any "while we're here, let's also..." idea is a separate PR)
- The right sidebar (`RightSidebar.vue`) — already its own component
- The canvas (`StackView.vue`, `FilesView.vue`, `CanvasViewToggle.vue`) — already extracted

## Open questions

1. **Phase A then Phase B as separate PRs**, or one big PR? **Default: separate PRs.** Phase A gives an immediate benefit, B is cosmetic. Easier to review separately.
2. **`useSessions.ts` size (~350 lines)** — comfortable as a single file, or split further? **Default: single file.** Splitting too aggressively makes the dependency graph harder to read. Reconsider only if the file becomes painful.
3. **Compatibility with PR #94 (chat-index)**: should this refactor wait until #94 is merged, or proceed in parallel? **Default: proceed in parallel** — the conflict surface is small (history pane preview + summary line), and #94's diff is local enough to rebase.
4. **Should the popups share a `useClickOutside` composable** — yes, default included.
