# fix #1929: chat-index scheduler skips content-unchanged sessions

## User prompt (JP)

> ログ見ると `[chat-index] indexed` が出過ぎにみえる。更新ないものはupdateしなくてよいのでもっと減るべきに見えるけど。。。

## Frequency (answering the follow-up)

`server/index.ts:1149-1155` registers `system:chat-index` on `intervalMs: ONE_HOUR_MS` — the scheduler ticks it every hour, with a `runOnce` catch-up policy. Plus:

- Agent finally hook calls `maybeIndexSession()` after each turn (with a 15-min `isFresh` throttle).
- `CHAT_INDEX_FORCE_RUN_ON_STARTUP=1` runs backfill once at boot when set.
- `POST /api/chat-index/rebuild` is the manual on-demand path.

## Root cause

`backfillAllSessions()` at `server/workspace/chat-index/index.ts:117-120` unconditionally passes `force: true` to every `indexSession()` call. The 15-min freshness throttle (`isFresh`) is the only skip logic in `indexSession`, and `force: true` bypasses it. Consequence: the hourly scheduler tick re-summarises every session — Claude CLI call + `[chat-index] indexed` log per session — even when the jsonl has not been touched since the last index.

## Fix

Two complementary changes:

### 1. New `sessionJsonlChangedSinceIndex` helper (indexer.ts)

Reads the entry file, extracts `indexedAt` as a millisecond timestamp, `stat`s the jsonl, returns `true` iff the jsonl's `mtimeMs > indexedAt`. Missing entry / malformed entry → `true` (index it). Missing jsonl → `false` (nothing to reindex).

Gate it inside `indexSession()` alongside the existing `isFresh` check, both guarded on `!force`:

```ts
if (!force) {
  if (await isFresh(...)) return null;                          // 15-min throttle
  if (!(await sessionJsonlChangedSinceIndex(...))) return null; // content unchanged
}
```

### 2. Make `force` opt-in on `backfillAllSessions` (index.ts)

- Add `force?: boolean` to the options bag. Default `false`.
- Remove the hardcoded `force: true` on the `indexSession` call.
- Thread the option through.

### 3. Callers

- `server/index.ts:1154` scheduler task: leave as `backfillAllSessions()` — default no force, respects both gates.
- `server/index.ts:~941` startup switch (`CHAT_INDEX_FORCE_RUN_ON_STARTUP`): pass `{ force: true }`.
- `server/api/routes/chat-index.ts:34` manual rebuild endpoint: pass `{ force: true }` (endpoint comment already says "force-rebuild every session's summary on demand").

## Tests

- `test_indexer.ts`: three new tests — skip when jsonl mtime ≤ indexedAt; re-index when jsonl mtime > indexedAt; `force: true` bypasses the content-changed gate.
- `test_maybe_index_session.ts`: adjust existing "backfillAllSessions re-indexes fresh sessions" test to pass `{ force: true }` explicitly (previously relied on the hardcoded force). Add a new "without force, skips content-unchanged sessions" test that uses `utimes` to control the jsonl mtime.

## Non-goals

- No change to `isFresh` or the 15-min throttle — it protects the agent finally hook during active conversations.
- No change to the scheduler interval (still 1 hour). The complaint is about work-per-tick, not tick frequency.
- No change to the `indexed` log level — after this fix, only actual work emits a log line, so the volume drops to the real update rate.
