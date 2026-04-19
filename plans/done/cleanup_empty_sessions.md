# Cleanup Empty Sessions on Navigation

## Problem

When a user is on a new empty session (no messages sent) and switches to another session via history or tab click, the empty session remains in:

1. **Chat history** (`sessionMap`) — it shows up in the sidebar and tab bar as a blank entry
2. **Browser navigation history** — pressing the back button returns to the empty session URL

This creates clutter in the session list and a confusing back-button experience.

## Prior Art

`createNewSession()` already had logic to remove the most-recently-touched empty session before creating a new one. However, `loadSession()` (triggered by clicking an existing session in history/tabs) did not perform this cleanup.

## Solution

### Extract `removeCurrentIfEmpty()`

A shared helper that checks whether the current session (`currentSessionId`) has zero `toolResults`. If so, it deletes the session from `sessionMap` and returns `true`.

```typescript
function removeCurrentIfEmpty(): boolean {
  const id = currentSessionId.value;
  if (!id) return false;
  const session = sessionMap.get(id);
  if (session && session.toolResults.length === 0) {
    sessionMap.delete(id);
    return true;
  }
  return false;
}
```

### Call from both `createNewSession()` and `loadSession()`

- **`createNewSession()`** — replaces the previous inline cleanup (which searched all sessions by sort order) with `removeCurrentIfEmpty()`. Simpler and more precise: the session being left is always the current one.

- **`loadSession()`** — calls `removeCurrentIfEmpty()` at the top, before any navigation. The returned boolean (`replaced`) is passed to `navigateToSession(id, replaced)`, which uses `router.replace` instead of `router.push` when an empty session was removed. This keeps the empty session URL out of browser history.

### Early-return guard in `loadSession()`

`loadSession()` has an early return to avoid re-loading the already-active session:

```typescript
if (id === currentSessionId.value && sessionMap.has(id)) return;
```

The `sessionMap.has(id)` check is essential. The route watcher sets `currentSessionId.value = newId` **before** calling `loadSession(newId)`. Without the `sessionMap.has` check, the guard would always match and bail out — preventing direct-URL navigation (`page.goto("/chat/<id>")`) and page reloads from loading the session data from the server.

### Effect on browser history

| Scenario | Before | After |
|---|---|---|
| New empty session → click existing session | Back button returns to empty session | Back button skips the empty session |
| New empty session → create new session | Empty session removed (existing behavior) | Same, now via shared helper |

## Files Changed

- `src/App.vue` — added `removeCurrentIfEmpty()`, updated `createNewSession()` and `loadSession()`
- `e2e/tests/router-navigation.spec.ts` — updated "browser forward works after going back" test to navigate between two non-empty sessions (the initial empty session is now intentionally replaced out of browser history)
