# feat: /api/sessions incremental fetch with server cursor (#205)

## Context

Issue [#205](https://github.com/receptron/mulmoclaude/issues/205). PR #203 made the initial `/api/sessions` response cheap (stat-only, no `.jsonl` body reads). The next bottleneck is **bandwidth + client-side JSON parse on every sidebar refresh** — the full 90-day window (~tens of KB for 100 sessions) is re-downloaded for every invalidation event.

Goal: **2 回目以降は差分だけ**. Server returns an opaque cursor; client echoes it back on the next call; server answers with only sessions that changed since then.

The user explicitly picked **approach A** (tombstone-shaped response) for this PR. Deletion doesn't exist in the product yet — I verified there's no `unlink` on any `chat/*.jsonl` path — so `deletedIds` is always `[]` today, but the surface is ready when deletion lands.

## Wire shape

**Before (still supported until clients migrate, but this PR flips everyone):**

```ts
GET /api/sessions → SessionSummary[]
```

**After:**

```ts
GET /api/sessions                  → { sessions: SessionSummary[], cursor: string, deletedIds: string[] }
GET /api/sessions?since=<cursor>   → same shape, `sessions` is a diff
```

`cursor` is opaque — the spec says so and the product can change the encoding without touching clients. Today it's `"v1:<maxChangeMs>"` where `maxChangeMs` is the most recent of every visible session's (`mtimeMs`, `indexedAt`). Parsing is defensive: anything that doesn't start with `v1:` or doesn't parse to a number is treated as "since 0" (= full resend).

## "Changed" = which timestamps?

A session is in the diff when either:

- its `.jsonl` mtime is newer than the cursor (new / resumed turn), OR
- its chat-index entry's `indexedAt` is newer than the cursor (AI title / summary refreshed in the background, doesn't touch mtime).

The `indexedAt` field already exists on `ChatIndexEntry` (see `server/workspace/chat-index/types.ts:27`). No schema migration needed.

## Server changes

1. `server/api/routes/sessions.ts` — accept `?since=`, compute `maxChangeMs`, filter by it, return the envelope.
2. Add a small pure helper `computeSessionsCursor(...)` / `filterChangedSessions(...)` in a sibling file or inline (prefer sibling — see Code Organization in CLAUDE.md) so tests don't need supertest.

### Edge cases

- **No `?since=`**: full list, cursor built from max change. Same code path — `since = 0`.
- **Invalid cursor**: treat as 0. Client gets a full resend, no 400. This is intentional — the one thing worse than a slow sidebar is a broken sidebar after a cursor-format rename.
- **Empty diff**: `sessions: []`, `cursor` echoed back (same value is fine), `deletedIds: []`. Client no-ops.
- **Server restart**: in-memory `sessionMap` is empty, so `isRunning` / `statusMessage` will flip to absent on the next diff. Acceptable — that's how the pre-diff world worked too.
- **exactOptionalPropertyTypes**: the `summary` / `keywords` / `isRunning` / `statusMessage` fields are still spread conditionally (matches existing code, line 119-126).

## Client changes

`src/composables/useSessionHistory.ts`:

- Keep `sessions: Ref<SessionSummary[]>` as the canonical cache.
- Add `cursor: Ref<string | null>`, persisted in memory only for now (tab-scoped; cross-tab sharing is noted as out of scope in the issue).
- First call: no `since` param. Cache the returned list + cursor.
- Subsequent calls: pass `?since=<cursor>`. Merge diff into cache.
- On error: preserve cache, set `historyError` (existing behaviour from #280 untouched).

### Diff merge

Add `applySessionDiff(cache, diff, deletedIds)` in `src/utils/session/mergeSessions.ts` next to `mergeSessionLists`:

- Upsert each diff entry by `id` (new = prepend, existing = replace).
- Remove any id in `deletedIds`.
- Re-sort by `updatedAt` desc (same comparator as server).
- Pure; returns a new array.

Unit-testable with no Vue harness.

## Backwards compatibility

The **response shape changes** (array → object). Every server build ships with every client build, so there's no split deploy to worry about — but we still guard:

- The e2e fixture's `GET /api/sessions` mock (`e2e/fixtures/api.ts`) returns the old array shape. Update it to the envelope. Tests that don't touch this endpoint aren't affected.
- Any code reading `response.data.sessions` via `apiGet<SessionsResponse>(...)` will now see the envelope.

## Out of scope for this PR

- Push-based real-time session updates (mentioned in issue as "別 issue").
- Cross-tab cursor sharing via `localStorage`.
- Deletion tombstones actually being populated (nothing deletes today).

## Tests

- **Unit**: new `test/routes/test_sessionsRoute.ts` covering: no `since` → full list; valid `since` → only newer; invalid cursor → full list; cursor roundtrips (pass the returned cursor back in, expect empty diff).
- **Unit**: extend `test/utils/session/test_mergeSessions.ts` with `applySessionDiff` cases: upsert, remove via `deletedIds`, stable sort.
- **Unit**: extend `test/composables/test_useSessionHistory.ts` with cursor send/receive + diff merge case.
- **E2E**: fixture update only — no behavioural e2e because the visible UI doesn't change.

## Checklist

- [ ] Server route accepts `?since=`, returns envelope with cursor + deletedIds
- [ ] Pure helpers extracted for test
- [ ] Client sends cursor on re-fetch; merges via `applySessionDiff`
- [ ] `applySessionDiff` added next to `mergeSessionLists`
- [ ] E2E fixture updated to envelope shape
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build`
- [ ] `yarn test` (new cases added)
- [ ] `yarn test:e2e`
- [ ] PR referencing #205
