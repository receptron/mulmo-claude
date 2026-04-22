# feat: Split layout preference from page routing

## Problem

`canvasViewMode` currently conflates two different concerns into one
enum, one localStorage key, and one `?view=` query param:

```ts
// src/utils/canvas/viewMode.ts
export const CANVAS_VIEW = {
  single: "single",   // layout variant of the chat page
  stack: "stack",     // layout variant of the chat page
  files: "files",     // distinct page
  todos: "todos",     // distinct page
  scheduler: "scheduler",
  wiki: "wiki",
  skills: "skills",
  roles: "roles",
} as const;
```

Consequences:

1. **Persistence is wrong.** `files`, `todos`, etc. get written to
   `localStorage["canvas_view_mode"]`, so the next session restores
   whichever page the user happened to leave on — not a layout
   preference, just a stale location.
2. **URLs are wrong.** `/files`, `/todos`, `/wiki` are distinct pages
   but share a single route (`/chat?view=files`). They cannot be
   bookmarked or linked to cleanly, and back/forward semantics route
   everything through the same `/chat/:sessionId` record.

## Design

Split into two independent concepts:

| Concept | Values | Storage | Scope |
|---|---|---|---|
| **Layout mode** | `single` \| `stack` | `localStorage["canvas_layout_mode"]` | Only meaningful on `/chat` |
| **Page** | `chat` \| `files` \| `todos` \| `scheduler` \| `wiki` \| `skills` \| `roles` | URL path | Global |

Layout is a user preference that sticks across sessions. Page is a
navigation target with its own URL and history entry.

## Router changes (`src/router/index.ts`)

Add real routes; drop `?view=` entirely.

```
/                          → redirect to /chat
/chat/:sessionId?          → chat page (single or stack layout)
/files                     → files page (keeps ?path=)
/todos                     → todos page
/scheduler                 → scheduler page
/wiki                      → wiki page (keeps ?page=)
/skills                    → skills page
/roles                     → roles page
/:pathMatch(.*)*           → redirect to /chat
```

`App.vue` switches top-level rendering on `route.name`, not on a
`canvasViewMode` variable.

## Composable changes

### New: `src/composables/useLayoutMode.ts`

Small, focused:

```ts
type LayoutMode = "single" | "stack";

export function useLayoutMode(): {
  layoutMode: Ref<LayoutMode>;
  setLayoutMode: (mode: LayoutMode) => void;
  toggleLayoutMode: () => void;
}
```

- Init from `localStorage["canvas_layout_mode"]`, defaulting to `"single"`.
- `setLayoutMode` / `toggleLayoutMode` write to localStorage.
- No router involvement.
- **One-time cleanup**: on module init, if the legacy
  `localStorage["canvas_view_mode"]` key exists, delete it. No value
  migration — start fresh.

### Delete: `src/composables/useCanvasViewMode.ts`

The responsibilities split:

- Layout state → `useLayoutMode`.
- Keyboard shortcuts → move handler to `App.vue` (or a new
  `useCanvasShortcuts` composable if it grows), calling
  `router.push()` for page keys and `toggleLayoutMode()` for Cmd+1.
- `filesRefreshToken` (bump after each agent run) → move to its own
  small composable, unchanged behavior.
- `onPluginNavigate` → plain `router.push({ name: target.key })`.
- `buildViewQuery` → delete entirely. `?view=` no longer exists, so
  session-navigation helpers in `App.vue` just push the path.

### Update: `src/composables/useViewLayout.ts`

`isStackLayout` really means "no left sidebar, full-width canvas
column" — it's the layout flag App.vue's template actually keys off.
That's true in two cases:

1. On `/chat` when the user's layout preference is `stack`.
2. On every non-chat page (`/files`, `/todos`, `/wiki`, `/skills`,
   `/roles`, `/scheduler`), which are full-page views with no sidebar
   by design.

Only `/chat` + `single` shows the sidebar. So the derivation is the
negation of that one case:

```ts
const isStackLayout = computed(
  () => !(isChatPage.value && layoutMode.value === "single")
);
```

Note: the layout preference itself (`layoutMode`) only meaningfully
affects `/chat`. On non-chat pages, `isStackLayout` is true regardless
of what the user has chosen — there's no sidebar to toggle there.

### Update: `src/utils/canvas/viewMode.ts`

Either delete outright, or reduce to just the `LayoutMode` type +
parser + `LAYOUT_MODE_STORAGE_KEY` constant. Page identifiers live in
the router, not here.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Cmd/Ctrl + 1 | Toggle layout (single ↔ stack). If not on `/chat`, navigate to `/chat` first and **do not** toggle on that press — the toggle requires a second press. Keeps Cmd+1 predictable as "go to chat", with the layout flip always a deliberate second action. |
| Cmd/Ctrl + 2 | Navigate to `/files` |
| Cmd/Ctrl + 3 | Navigate to `/todos` |
| Cmd/Ctrl + 4 | Navigate to `/scheduler` |
| Cmd/Ctrl + 5 | Navigate to `/wiki` |
| Cmd/Ctrl + 6 | Navigate to `/skills` |
| Cmd/Ctrl + 7 | Navigate to `/roles` |

Alt / Shift modifiers still disable the shortcut (unchanged).

## Call-site updates

- **`src/components/CanvasViewToggle.vue`** — becomes a pure
  single/stack toggle. Visible only when `route.name === "chat"` (or
  disabled on other pages, TBD in implementation — likely hidden).
- **`PluginLauncher.onPluginNavigate`** — replace
  `setCanvasViewMode(target.key)` with `router.push({ name: target.key })`.
- **`App.vue`**
  - Drop `buildViewQuery` and any session-navigation logic that
    appended `?view=`.
  - Render page components via `<router-view>` or a `v-if` ladder on
    `route.name`.
  - Sidebar visibility uses the new `isStackLayout` computed.
- **Tests** — `src/utils/canvas/viewMode.test.ts` (and any composable
  tests) need to be rewritten or deleted to match the new split. E2E
  tests that navigate via `?view=` need to be updated to use the new
  paths.

## Explicit non-goals

- **No data migration.** Old `canvas_view_mode` value is ignored and
  the key is deleted on first read. Users land on `/chat` with
  `layoutMode = "single"` on first load after the change. This is
  deliberate and the user confirmed it.
- **No layout preference per-page.** Stack is a /chat concept only.
  Other pages do not grow a layout toggle.
- **No backwards-compat URL shim.** Old `/chat?view=files` links will
  hit `/chat` (the `?view=` query is simply ignored). Acceptable
  given this is a pre-1.0 app and the URLs were never documented as
  stable.

## Implementation order

1. Add routes in `src/router/index.ts` (all new paths resolve to the
   existing chat stub initially, so nothing breaks).
2. Add `useLayoutMode` composable + legacy key cleanup.
3. Update `useViewLayout` to take layout + route into account.
4. Update `App.vue`: `<router-view>` or `route.name` switch, drop
   `?view=` handling, wire new shortcut handler.
5. Update `CanvasViewToggle` + `PluginLauncher` call sites.
6. Delete `useCanvasViewMode`, prune `viewMode.ts`.
7. Update/remove tests, run `yarn format && yarn lint && yarn
   typecheck && yarn test && yarn build`.
8. Manual smoke: toggle Cmd+1 on /chat, Cmd+2–7 navigate, reload on
   each page, back/forward button, bookmark `/files?path=foo/bar`.

## Open questions

- **Cmd+1 from non-chat (already decided above: navigate-only, toggle
  on second press).** Flagged here in case reconsidered before
  implementation.
- Should `CanvasViewToggle` be hidden or disabled on non-chat pages?
  Lean: hidden, since it has no effect there.
