# Subscribe to session channel when viewing

## Context

The per-session `session.<id>` pub/sub subscription only happened when the user sent a message or switched to an already-running session. If another browser tab (or task manager job) started a run on a session being viewed, the viewing tab missed all real-time events.

## Changes

### `src/App.vue`

1. **`watch(currentSessionId)`** — subscribe unconditionally (removed `isRunning` guard). Track `previousSessionId` and unsubscribe idle sessions on switch.

2. **`loadSession`** — call `ensureSessionSubscription` after `sessionMap.set` using `sessionMap.get(id)!` (the reactive proxy, not the raw object) to ensure Vue reactivity tracking works.

3. **`session_finished` handler** — keep subscription alive when the user is viewing the session (`currentSessionId === session.id`). Only unsubscribe sessions the user is NOT viewing. This allows receiving events from subsequent runs started by other tabs.

4. **`applyAgentEvent` `text` case** — handle `source: "user"` events. Deduplicates against the last entry in `toolResults` so the sending tab doesn't show the user message twice.

### `server/routes/agent.ts`

Broadcast user messages via `pushSessionEvent({ type: "text", source: "user", message })` after `getOrCreateSession` so other tabs see user input.

### `src/types/sse.ts`

Added `source?: "user" | "assistant"` to `SseText`.

## Key bugs fixed

1. **No subscription on URL-based load**: Route watcher set `currentSessionId` before `loadSession` populated `sessionMap`, so the `watch(currentSessionId)` callback found no session to subscribe.

2. **Subscription torn down after every run**: `session_finished` always called `unsubscribeSession`, so the viewing tab went blind after the first run completed.

3. **Raw object vs reactive proxy**: `ensureSessionSubscription` captured the unwrapped object instead of the reactive proxy from `sessionMap.get()`, so mutations didn't trigger Vue re-renders.
