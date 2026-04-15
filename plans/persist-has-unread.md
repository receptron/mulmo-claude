# Persist `hasUnread` in session metadata

## Context

The `hasUnread` flag currently lives only in the in-memory `ServerSession` store (`server/session-store/index.ts`). When the server restarts, all unread state is lost. This change persists the flag in the per-session metadata file (`chat/{sessionId}.json`) so it survives restarts.

## Approach

Reuse the existing per-session metadata file (`~/mulmoclaude/chat/{sessionId}.json`), which already holds `roleId`, `startedAt`, `firstUserMessage`, and `claudeSessionId`. The read-merge-write pattern is already established (see `updateClaudeSessionId` and `backfillFirstUserMessage` in `server/routes/agent.ts`).

## Files to modify

### 1. `server/routes/sessions.ts`

- Add `hasUnread?: boolean` to the `SessionMeta` interface (line 11).
- In `GET /api/sessions` (line 73): when no live session exists in the in-memory store, fall back to `meta.hasUnread ?? false` instead of omitting the field.

### 2. `server/session-store/index.ts`

- Add a helper `persistHasUnread(chatSessionId, hasUnread)` that reads the `{chatSessionId}.json` metadata file, merges `{ hasUnread }`, and writes it back. Needs `workspacePath` to build the path.
- **`endRun()`** (line 112): after setting `session.hasUnread = true`, call `persistHasUnread(chatSessionId, true)`.
- **`markRead()`** (line 133): after setting `session.hasUnread = false`, call `persistHasUnread(chatSessionId, false)`.
- **`getOrCreateSession()`** (line 58): accept an optional `hasUnread` param so the caller can seed the in-memory store from the persisted value.

### 3. `server/routes/agent.ts`

- In `startChat()`, after reading/writing the metadata file, pass `meta.hasUnread` into `getOrCreateSession()` so the in-memory store starts with the persisted value.

## Verification

1. `yarn format && yarn lint && yarn typecheck && yarn build`
2. `yarn test` — existing unit tests pass
3. Manual test:
   - Start the dev server, send a message in session A, switch to session B
   - Wait for session A to finish — verify unread badge appears
   - Restart the server — verify the unread badge still shows for session A
   - Click session A — verify the badge clears and stays cleared after another restart
