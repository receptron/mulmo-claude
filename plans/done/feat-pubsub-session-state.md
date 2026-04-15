# Plan: SSE → WebSocket Pub/Sub with Server-Side Session State

## Context

Agent events used to flow from the server to a **single client** via an SSE stream tied to the `POST /api/agent` HTTP response. Session state (`isRunning`, `hasUnread`, `toolCallHistory`, etc.) lived entirely client-side in `sessionMap`. This meant:

- Only one browser tab could see live progress
- A second tab or late-joining client missed all events
- The sidebar's running/unread badges were client-local fiction

The codebase already had a WebSocket pub/sub system (`server/pub-sub/index.ts` + `src/composables/usePubSub.ts`) used only for debug heartbeat. This plan migrated agent event delivery to that pub/sub layer and moved session state to the server so multiple clients stay in sync.

---

## Design Principles

1. **Server is the single source of truth** for session state (`isRunning`, `hasUnread`, `statusMessage`). Clients never set these locally — they always come from `GET /api/sessions`.

2. **Pub/sub is a notification pipe, not a data pipe.** The `sessions` channel publishes a bare `{}` signal meaning "something changed — refetch." No session IDs, no state data in the message. The `session.<id>` channel carries streaming event data (tool calls, text, etc.) because those are real-time and cannot be polled.

3. **REST is for state.** `GET /api/sessions` returns the full session list including live state (`isRunning`, `hasUnread`, `statusMessage`) merged from the in-memory session store. Clients call this on startup and after every `sessions` channel notification.

### Two pub/sub channels

| Channel | Purpose | Message |
|---|---|---|
| `session.<chatSessionId>` | Per-session streaming events | `tool_call`, `tool_call_result`, `status`, `text`, `tool_result`, `switch_role`, `roles_updated`, `error`, `session_finished` |
| `sessions` | "Session list changed" notification | `{}` (bare signal, no data) |

### Server-side session state — `server/session-store/`

Replaces `server/sessions.ts`. Holds a `Map<chatSessionId, ServerSession>`:

```ts
interface ServerSession {
  chatSessionId: string;
  roleId: string;
  isRunning: boolean;
  hasUnread: boolean;
  statusMessage: string;
  toolCallHistory: ToolCallHistoryItem[];
  resultsFilePath: string;
  selectedImageData?: string;
  startedAt: string;
  updatedAt: string;
  abortRun?: () => void;
}
```

- `toolResults` is **not** held in memory — persisted to JSONL and loaded on demand via `GET /api/sessions/:id`.
- `selectedResultUuid` stays client-local (viewport state).
- Sessions are evicted from the store after 1 hour idle.
- Every state mutation calls `notifySessionsChanged()` which publishes `{}` to the `sessions` channel.

### `GET /api/sessions` — the state API

Returns `SessionSummary[]` with live state merged from the session store:

```ts
interface SessionSummary {
  id: string;
  roleId: string;
  startedAt: string;
  updatedAt: string;
  preview: string;
  summary?: string;
  keywords?: string[];
  isRunning?: boolean;      // from session store
  hasUnread?: boolean;       // from session store
  statusMessage?: string;    // from session store
}
```

All clients read `isRunning`/`hasUnread`/`statusMessage` from this response. The client's `sessionMap` is for local UI state only (toolResults, selectedResultUuid, toolCallHistory).

### `POST /api/agent` — fire-and-forget (HTTP 202)

1. Validate request → 400 if invalid
2. Create/update `ServerSession` in store, set `isRunning = true`
3. Notify `sessions` channel
4. Spawn agent loop as a **detached async task** (not awaited)
5. Return `202 { chatSessionId }`

The agent loop publishes each event to `session.<chatSessionId>`. On completion, `endRun()` sets `isRunning = false`, `hasUnread = true`, publishes `session_finished` + notifies `sessions` channel.

### Client state flow

```
sessions channel notification
  → fetchSessions()            (GET /api/sessions)
  → sessions.value updated     (SessionSummary[] with live state)
  → computed properties react  (isRunning, statusMessage, badges, tab colors)
  → refreshSessionStates()     (syncs into sessionMap for sessions already in memory)
```

All computed properties (`isRunning`, `statusMessage`, `activeSessionCount`, `unreadCount`, `tabColor`) read from `sessions.value` (server data) first, with `sessionMap` as a fallback only during the initial load before the first fetch completes.

`beginUserTurn` does NOT set `isRunning` or `statusMessage` — it only appends the user's message to `toolResults` for immediate display. The server sets `isRunning = true` in `beginRun()`, notifies all clients, and they all refetch.

### Cancellation

`POST /api/agent/cancel { chatSessionId }` — calls `session.abortRun()` which aborts the `AbortController` passed to `runAgent()`, killing the CLI process. The agent loop's `finally` block fires normally, calling `endRun()`.

### `hasUnread`

- Server sets `hasUnread = true` unconditionally when agent finishes (`endRun()`)
- Client clears via `POST /api/sessions/:id/mark-read` when:
  - User switches to a session (`watch(currentSessionId)`)
  - `session_finished` arrives for the currently viewed session
- `mark-read` triggers `notifySessionsChanged()` so other tabs refetch and see the cleared flag
- `refreshSessionStates` skips setting `hasUnread = true` on the currently viewed session to prevent a brief flash before the mark-read roundtrip

### MCP session ID change

The MCP server receives `chatSessionId` (stable across turns) as `SESSION_ID` env var instead of the per-run UUID. This ensures `/internal/tool-result` lookups hit the session store correctly.

---

## File Changes

### New files

| File | Purpose |
|---|---|
| `server/session-store/index.ts` | `ServerSession` type, Map store, lifecycle (get/create/remove), state mutations (beginRun/endRun/cancelRun/markRead), pub/sub notification, idle eviction |

### Modified files

| File | Change |
|---|---|
| `server/pub-sub/index.ts` | Unchanged interface — single `publish()` method, no hooks |
| `server/routes/agent.ts` | Fire-and-forget 202, background agent loop via `runAgentInBackground()`, `POST /api/agent/cancel` |
| `server/routes/sessions.ts` | `GET /api/sessions` merges live state from session store; added `POST /sessions/:id/mark-read` |
| `server/agent/config.ts` | `buildMcpConfig` takes `chatSessionId` as `SESSION_ID` env var |
| `server/agent.ts` | Added `abortSignal` param to `runAgent()` |
| `server/index.ts` | Wires `initSessionStore(pubsub)` |
| `server/routes/roles.ts` | Uses `pushSessionEvent` from session store |
| `server/routes/image.ts` | Uses `getSessionImageData` from session store |
| `src/App.vue` | `sessions` channel → `refreshSessionStates()`; `isRunning`/`statusMessage`/badges read from `sessions.value`; `beginUserTurn` no longer sets state; `sendMessage` subscribes to `session.<id>` then POSTs 202 |
| `src/components/SessionHistoryPanel.vue` | Checks `SessionSummary` fields (server data) for running/unread, `sessionMap` as fallback |
| `src/utils/session/mergeSessions.ts` | `buildLiveSummary` carries `isRunning`/`hasUnread`/`statusMessage` from server entry |
| `src/types/session.ts` | `SessionSummary` gains `isRunning?`, `hasUnread?`, `statusMessage?` |
| `src/types/sse.ts` | Added `SseSessionFinished` event type |
| `src/composables/usePubSub.ts` | No new API — clients use `subscribe()` only |
| `e2e/fixtures/api.ts` | Mocks for 202 agent response, mark-read, cancel |
| `e2e/tests/chat-flow.spec.ts` | Rewrote SSE tests to use WebSocket pub/sub mocks via `page.routeWebSocket` |

### Deleted files

| File | Reason |
|---|---|
| `server/sessions.ts` | Replaced by `server/session-store/` |
| `src/utils/agent/sse.ts` | SSE line parsing no longer needed (WS messages are JSON-framed) |
| `test/utils/agent/test_sse.ts` | Tests for deleted module |

---

## Verification

1. **Single client**: send a message, verify tool calls appear in sidebar, final text in canvas, `isRunning` spinner shows/hides, status message updates
2. **Two tabs, same session**: open same session in two tabs, send message from one, verify both tabs see the running animation, tool calls, and final text
3. **Two tabs, different sessions**: start a run in tab A, verify tab B's sidebar/tab bar shows the running state and unread badge after completion
4. **Late joiner**: start an agent run, open a new tab — verify it sees `isRunning` from `GET /api/sessions` and can subscribe to the live event stream
5. **Unread**: start a run, switch away before it finishes — verify unread badge. Switch back — verify badge clears on all tabs. Verify the currently viewed session does NOT flash unread.
6. **Cancel**: start a long-running agent, hit cancel, verify process stops and `session_finished` is published
7. **Tests**: `yarn test` (1099 unit tests), `yarn test:e2e` (112 Playwright tests including pub/sub mocks)
