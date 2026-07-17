# fix #1915 (reopened) — catch-up misses a truncated final text card

## Context

#1934 fixed the stuck "thinking" indicator (Fix A/B/D). The reporter
(`ystknsh`) reopened with a remaining UI-sync hole:

- A long assistant response stops mid-sentence on screen (e.g. `理由によ`).
- The run itself completed; the server jsonl has the full text.
- Reload shows the whole response.

So the server transcript is complete; only the client's live local state is
truncated.

## Root cause

`refreshSessionTranscript()` (`src/App.vue`) adopts the server transcript only
when it has **more cards** than the client:

```ts
if (serverResults.length > session.toolResults.length) {
  session.toolResults = serverResults;
}
```

In the reported case the card **count is identical** — only the last assistant
text card's body is longer on the server (the live stream stalled mid-text and
the tail deltas were lost). The count check is false, so catch-up never runs and
the truncated card stays.

## Fix

Extract a pure predicate `serverTranscriptAheadOfClient(server, client)` in
`src/utils/session/sessionEntries.ts` and use it as the guard:

- counts differ → keep the original behavior (`server.length > client.length`).
- counts equal → upgrade only when the **final card is strictly longer**
  server-side.

Only the trailing card can lag mid-stream (earlier cards freeze once a newer one
opens), so comparing the final card is sufficient and — crucially — never
downgrades a richer in-flight state: during normal streaming the client's last
card is equal-or-ahead of the server's on-disk copy, so the predicate returns
false and nothing is touched.

## Why this is side-effect-free

- `handleSessionFinished` path: the turn is over, no concurrent streaming —
  replacing a truncated final card is always safe.
- `catchUpMissedEvents` path (reconnect / visibility): fires only after events
  were genuinely dropped; socket.io does not redeliver missed events, so there
  are no in-flight deltas to double-append. `appendToLastAssistantText` appends
  to the last card **by position**, so a replaced array still accepts later
  appends correctly.
- Strict "longer" comparison preserves the original no-downgrade guard.

## Files

- `src/utils/session/sessionEntries.ts` — new `serverTranscriptAheadOfClient`.
- `src/App.vue` — use it in `refreshSessionTranscript`; refresh the two stale
  comments describing the guard.
- `test/utils/session/test_sessionEntries.ts` — 7 cases incl. the reopened bug
  (equal count, longer last card) and the no-downgrade guarantees.
