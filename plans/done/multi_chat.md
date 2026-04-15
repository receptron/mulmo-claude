# Concurrent Chat Sessions

## Goal

Allow multiple agent sessions to run simultaneously. While one session is waiting on a long Claude task, the user can open a new session and start chatting. Sessions are managed via the existing history pane — no tab bar.

## Key Insight: Server Is Already Ready

Each `POST /api/agent` spawns an independent claude process with its own SSE stream and session ID. Express handles concurrent requests natively. No server-side changes are needed.

The entire change is on the frontend.

---

## Design

### Active Session State

Introduce a client-side `ActiveSession` type that holds all per-session runtime state:

```typescript
interface ActiveSession {
  id: string;                          // chatSessionId (JSONL filename)
  roleId: string;
  toolResults: ToolResultComplete[];
  isRunning: boolean;
  statusMessage: string;
  toolCallHistory: ToolCallHistoryItem[];
  selectedResultUuid: string | null;
  abortController: AbortController;   // for cancellation
}
```

Replace the current global refs:

| Before | After |
|---|---|
| `chatSessionId: ref<string>` | `currentSessionId: ref<string>` (pointer into map) |
| `isRunning: ref<boolean>` | `activeSession.value.isRunning` |
| `toolResults: ref<ToolResultComplete[]>` | `activeSession.value.toolResults` |
| `statusMessage: ref<string>` | `activeSession.value.statusMessage` |
| `toolCallHistory: ref<ToolCallHistoryItem[]>` | `activeSession.value.toolCallHistory` |
| `selectedResultUuid: ref<string \| null>` | `activeSession.value.selectedResultUuid` |

Add:

```typescript
const sessionMap = ref<Map<string, ActiveSession>>(new Map());
const currentSessionId = ref<string>("");
const activeSession = computed(() => sessionMap.value.get(currentSessionId.value));
```

All template bindings and functions that reference the old globals are updated to go through `activeSession.value`.

### Creating a New Session

When the user clicks "New session" (the `+` button), instead of resetting global state:
1. Generate a new `chatSessionId`
2. Create a fresh `ActiveSession` entry in `sessionMap`
3. Set `currentSessionId` to the new ID

The previous session remains in `sessionMap` with its stream still running in the background.

### Switching Sessions via History Pane

`loadSession(id)` currently resets all global state. The new behaviour:

- If `id` is already in `sessionMap` (i.e. currently active/running): just switch `currentSessionId` to it. No fetch needed — state is live in memory.
- If `id` is not in `sessionMap` (a past, fully completed session from disk): fetch from `/api/sessions/:id`, reconstruct an `ActiveSession` with `isRunning: false`, add it to `sessionMap`, set `currentSessionId`.

### History Pane: Indicating Active Sessions

The history pane renders a list of `SessionSummary[]` from the server. Active sessions may not yet be in that list (they're in-flight). The approach:

1. Merge the history list with `sessionMap` entries before rendering:
   - For sessions already in `sessionMap`, overlay the live `isRunning` status
   - Sessions in `sessionMap` that aren't yet saved to disk still appear (using in-memory preview)
2. Show a running indicator (e.g. animated spinner or coloured dot) on any session where `isRunning === true`
3. Highlight the currently viewed session

```
● General — just now          ← active session (spinner)
  "Write a blog post about…"

  General — 2 hours ago       ← loaded, not running
  "Summarise my todos"

  Assistant — yesterday
  "Create calendar event"
```

The history pane is always visible (not just on toggle) or opened whenever the user wants to switch — same UX as today, just enriched with live state.

### History Icon Badges

The history button shows two small number badges:

```
      [2]  ← unread replies
  🕐 [1]  ← active sessions
```

- **Active sessions badge** (bottom or left): count of sessions in `sessionMap` where `isRunning === true`. Disappears when zero.
- **Unread replies badge** (top or right): count of background sessions that finished while the user was viewing a different session. A session becomes "unread" when its `isRunning` transitions `true → false` and it is not the currently viewed session. Cleared when the user switches to that session.

Add to `ActiveSession`:

```typescript
interface ActiveSession {
  ...
  hasUnread: boolean;  // true when reply arrived while session was not current
}
```

Computed values driving the badges:

```typescript
const activeSessionCount = computed(
  () => [...sessionMap.value.values()].filter((s) => s.isRunning).length
);
const unreadCount = computed(
  () => [...sessionMap.value.values()].filter((s) => s.hasUnread).length
);
```

`hasUnread` is set to `true` inside `sendMessage()`'s SSE completion handler when `session.id !== currentSessionId.value`. It is cleared in `loadSession()` / when switching to that session.

### Cancellation

Each `ActiveSession` holds an `AbortController`. The existing stop button calls `controller.abort()` on the current session's controller, leaving other sessions unaffected.

---

## Implementation Steps

1. **Define `ActiveSession` type** in `src/App.vue` (or extract to `src/types.ts`)

2. **Replace global refs** with `sessionMap` + `currentSessionId` + `activeSession` computed

3. **Update `createNewSession()`** (rename from current `onRoleChange` reset logic):
   - Allocate new `ActiveSession`, insert into `sessionMap`, update `currentSessionId`

4. **Update `loadSession(id)`**:
   - Short-circuit if `id` is already in `sessionMap`
   - Otherwise load from server and add to `sessionMap`

5. **Update `sendMessage()`**:
   - Write stream events into `activeSession.value` instead of global refs

6. **Update history pane template**:
   - Merge `sessions` (server list) with live keys from `sessionMap`
   - Render spinner on running sessions
   - Highlight current session

7. **Add history icon badges**:
   - `activeSessionCount` computed: sessions in `sessionMap` with `isRunning === true`
   - `unreadCount` computed: sessions with `hasUnread === true`
   - Render both counts as small overlaid badges on the history button
   - Set `hasUnread = true` when a background session's stream completes
   - Clear `hasUnread` when switching to that session

8. **Update all template bindings** that read `isRunning`, `toolResults`, `statusMessage`, `toolCallHistory`, `selectedResultUuid` to go through `activeSession.value`

---

## What Does NOT Change

- Server routes — no changes
- Session persistence (JSONL files) — no changes
- The history toggle button and popup layout — minimal changes
- Role switching — still creates a new session (same as today)
- `fetchSessions()` — still fetches from `/api/sessions` for the history list
