# feat: /history route

Tracks: #653

## Goal

Promote the session-history popup from a click-toggled overlay to a real page route at `/history`. Makes it bookmarkable, deep-linkable, and brings browser back/forward into the flow.

## Design

### Why a page route, not a query param

The panel already covers the whole canvas column (absolute positioning, full height). It's effectively a page — the "overlay" framing is a leftover from when history was a small dropdown. Promoting it to a canvas-column view removes the z-index stacking, topOffset measurement, and click-outside plumbing in one step.

### Router

`PAGE_ROUTES.history = "history"` + `{ path: "/history", name: PAGE_ROUTES.history, component: Stub }` in `src/router/index.ts`.

### App.vue wiring

The canvas column already uses `v-else-if="currentPage === 'files' / 'wiki' / ..."`, so adding `'history'` is one more branch:

```vue
<SessionHistoryPanel
  v-else-if="currentPage === 'history'"
  :sessions="mergedSessions"
  :current-session-id="currentSessionId"
  :roles="roles"
  :error-message="historyError"
  @load-session="handleSessionSelect"
/>
```

The overlay `<SessionHistoryPanel v-if="showHistory">` is removed entirely.

### SessionHistoryPanel refactor

Drop overlay styling:

- Root was `absolute left-0 right-0 bottom-0 z-50 shadow-lg` with `:style="{ top: topOffset ? topOffset + 'px' : '4rem' }"`. Becomes `h-full overflow-y-auto bg-white`.
- `topOffset` prop removed.

The panel's content is unchanged (filter pills, session cards, error banner).

### SessionTabBar integration

History button currently `emit("toggleHistory")`. Change to `emit("openHistory")` — App.vue handles it:

```ts
function handleHistoryClick(): void {
  if (currentPage.value === "history") {
    // Second click on the history button closes the page back to
    // the last chat.
    router.back();
  } else {
    router.push({ name: PAGE_ROUTES.history }).catch(() => {});
  }
}
```

The button's "open" visual state is `currentPage === 'history'` (already derived from `route.name`). Pass as `:history-open="currentPage === 'history'"`.

### useSessionHistory cleanup

Drop `showHistory` and `toggleHistory`. They become dead code once the URL is the state. `fetchSessions` stays; callers fire it on route enter rather than on toggle.

### Fetch on route enter

In App.vue, watch `currentPage`:

```ts
watch(currentPage, (page) => {
  if (page === "history") fetchSessions();
}, { immediate: true });
```

### Other cleanups

- `watch(showHistory, ...)` that measures `historyTopOffset` — removed.
- `historyTopOffset`, `historyPopupRef`, `handleClickOutsideHistory` — removed (no click-outside needed on a page).
- `showHistory.value = false` inside `activateSession` — removed (navigating away from /history happens naturally via router.push to /chat/:id).

## Files touched

- `src/router/index.ts` — add `/history` route
- `src/components/SessionHistoryPanel.vue` — drop overlay styling + topOffset prop
- `src/components/SessionTabBar.vue` — emit `openHistory` (or keep toggleHistory, but callers change)
- `src/composables/useSessionHistory.ts` — drop `showHistory` / `toggleHistory`
- `src/App.vue` — canvas branch + button handler + route watcher + remove overlay/measurement plumbing

## Out of scope

- URL-backed filter state (e.g. `/history?filter=unread`) — filter stays in component-local ref
- Scroll-position persistence across navigation
- Keyboard shortcuts to open/close history

### Browser-history semantics

`/history` is a real page route. Clicking a session pushes `/chat/:id` on top of `/history`, so browser back from the chat returns to `/history` (re-renders the panel). This matches the mental model of "I visited the history page, clicked a session, now go back". Session-to-session navigation via the panel leaves `/history` entries in the stack between sessions — going back through them is a deliberate trace of how the user got there.

## Test plan

- Manual
  - Click history button on `/chat/<id>` → URL flips to `/history`, panel renders inline
  - Click a session card → URL flips to `/chat/<id>`
  - Browser back → returns to `/history` (panel re-renders)
  - Browser back again → returns to the prior chat
  - Direct-link `/history` → panel opens with fetched sessions
  - On `/history`, click history button again → `router.back()` goes to prior page
- Existing e2e for session history still green (modal-style interactions updated for the route-based flow)
- `yarn typecheck` / `yarn lint` / `yarn build` clean
