# Plan: SSE → WebSocket Pub/Sub with Server-Side Session State

## Context

Agent events used to flow from the server to a **single client** via an SSE stream tied to the `POST /api/agent` HTTP response. Session state (`isRunning`, `hasUnread`, `toolCallHistory`, etc.) lived entirely client-side in `sessionMap`. This meant:

- Only one browser tab could see live progress
- A second tab or late-joining client missed all events
- The sidebar's running/unread badges were client-local fiction

The codebase already had a WebSocket pub/sub system (`server/pub-sub/index.ts` + `src/composables/usePubSub.ts`) used only for debug heartbeat. This plan migrated agent event delivery to that pub/sub layer and moved session state to the server so multiple clients stay in sync.

---

## Design

### Pub/sub is event-only, REST is for state

The pub/sub layer (`IPubSub`) has a single method: `publish(channel, data)`. It is a pure broadcast pipe — no snapshots, no per-client delivery, no subscribe hooks. Clients that need current state (e.g. a new tab joining mid-run) fetch it via REST (`GET /api/sessions`, `GET /api/sessions/:id`) and then subscribe to the pub/sub channel for live updates going forward.

### Two pub/sub channels

| Channel | Purpose | Events |
|---|---|---|
| `session.<chatSessionId>` | Per-session event stream | `tool_call`, `tool_call_result`, `status`, `text`, `tool_result`, `switch_role`, `roles_updated`, `error`, **`session_finished`** |
| `sessions` | Global session list changes | `session_state_changed { chatSessionId, isRunning, hasUnread, statusMessage, updatedAt }`, `session_removed` |

### Server-side session state — `server/session-store/`

Replaces `server/sessions.ts`. Holds a `Map<chatSessionId, ServerSession>` with:

```ts
interface ServerSession {
  chatSessionId: string;
  roleId: string;
  isRunning: boolean;
  hasUnread: boolean;          // global, not per-client
  statusMessage: string;
  toolCallHistory: ToolCallHistoryItem[];
  resultsFilePath: string;
  selectedImageData?: string;
  startedAt: string;
  updatedAt: string;
  abortRun?: () => void;       // kills the child process
}
```

- `toolResults` is **not** held in memory — already persisted to JSONL and loaded on demand via `GET /api/sessions/:id`.
- `selectedResultUuid` stays client-local (viewport state).
- Sessions are evicted from the store after 1 hour idle.

### `POST /api/agent` — fire-and-forget (HTTP 202)

1. Validate request → 400 if invalid
2. Create/update `ServerSession` in store, set `isRunning = true`
3. Publish `session_state_changed` on `sessions` channel
4. Spawn agent loop as a **detached async task** (not awaited)
5. Return `202 { chatSessionId }`

The agent loop publishes each event to `session.<chatSessionId>`. On completion, `endRun()` sets `isRunning = false`, `hasUnread = true`, publishes `session_finished` + `session_state_changed`.

### Cancellation

`POST /api/agent/cancel { chatSessionId }` — calls `session.abortRun()` which aborts the `AbortController` passed to `runAgent()`, killing the CLI process. The agent loop's `finally` block fires normally, calling `endRun()`.

### `hasUnread` — server-side with client-side guard

- Server sets `hasUnread = true` unconditionally when agent finishes (`endRun()`)
- Client clears via `POST /api/sessions/:id/mark-read` in two places:
  - When user switches to a session (existing `watch(currentSessionId)`)
  - When `session_finished` arrives for the currently viewed session
- Client-side `applySessionStateEvent` **never** sets `hasUnread = true` for the currently viewed session — prevents the `sessions` channel race from overwriting the local read state
- Published on `sessions` channel both ways

### MCP session ID change

The MCP server receives `chatSessionId` (stable across turns) as `SESSION_ID` env var instead of the per-run UUID. This ensures `/internal/tool-result` lookups hit the session store correctly.

---

## File Changes

### New files

| File | Purpose |
|---|---|
| `server/session-store/index.ts` | `ServerSession` type, Map store, init/get/update/remove, pub/sub integration, idle eviction |

### Modified files

| File | Change |
|---|---|
| `server/pub-sub/index.ts` | Unchanged interface — still just `publish()`. Removed snapshot/subscribe hook complexity. |
| `server/routes/agent.ts` | Fire-and-forget 202, background agent loop via `runAgentInBackground()`, `POST /api/agent/cancel` endpoint |
| `server/agent/config.ts` | `buildMcpConfig` takes `chatSessionId` (not per-run `sessionId`) as `SESSION_ID` env var |
| `server/agent.ts` | Added `abortSignal` param to `runAgent()` for cancellation |
| `server/index.ts` | Wires `initSessionStore(pubsub)` |
| `server/routes/sessions.ts` | Added `POST /sessions/:id/mark-read` endpoint |
| `server/routes/roles.ts` | Uses `pushSessionEvent` from session store |
| `server/routes/image.ts` | Uses `getSessionImageData` from session store |
| `src/App.vue` | Subscribes to `session.<id>` channel for events, `sessions` channel for sidebar state, `mark-read` on session switch + session finish |
| `src/composables/usePubSub.ts` | No new API — clients use `subscribe()` only |
| `src/types/sse.ts` | Added `SseSessionFinished` event type |
| `e2e/fixtures/api.ts` | Mocks for 202 agent response, mark-read, cancel |
| `e2e/tests/chat-flow.spec.ts` | Rewrote SSE tests to use WebSocket pub/sub mocks via `page.routeWebSocket` |

### Deleted files

| File | Reason |
|---|---|
| `server/sessions.ts` | Replaced by `server/session-store/` |
| `src/utils/agent/sse.ts` | SSE line parsing no longer needed (WS messages are already JSON-framed) |
| `test/utils/agent/test_sse.ts` | Tests for deleted module |

---

## Verification

1. **Single client**: send a message, verify tool calls appear in sidebar, final text appears in canvas, status message updates, `isRunning` badge shows/hides
2. **Two tabs**: open same session in two tabs, send message from one, verify both tabs see progress and results
3. **Late joiner**: start agent run, open a second tab — fetch current state via REST, then subscribe to pub/sub for live events going forward
4. **Unread**: start a run, switch to another session before it finishes, verify unread badge appears. Switch back, verify it clears. Open a second tab — verify badge state is consistent. Verify the currently viewed session does NOT flash unread when it finishes.
5. **Cancel**: start a long-running agent, hit cancel, verify process stops and `session_finished` is published
6. **Tests**: `yarn test` (1099 unit tests), `yarn test:e2e` (112 Playwright tests including pub/sub mocks)
