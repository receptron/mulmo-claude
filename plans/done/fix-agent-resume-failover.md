# Fail-over for stale `claude --resume` session id (#211)

## Problem

Sending a message in an existing chat session sometimes 500s with:

> [Error] No conversation found with session ID: cf40e522-…

The Claude CLI's local store no longer has the conversation (cache
evicted, CLI reinstalled, machine migration), so `--resume <id>`
dies. Our jsonl transcript is intact but unused as a fallback.

## Scope (this PR)

Recover automatically when that specific error is detected:

1. Keep a retry budget of **1** per run (only when we entered with a
   `claudeSessionId`; fresh sessions can't hit this error).
2. Detect the error by matching the stable phrase
   `"No conversation found with session ID"` in the surfaced stderr.
3. Clear the stale id from the meta file.
4. Build a natural-language preamble from the session jsonl, keeping
   only `{source: user|assistant, type: text}` entries (tool calls /
   results don't replay cleanly as prose).
5. Truncate the preamble to a hard cap (50KB default; oldest turns
   dropped first) so a runaway transcript can't dominate Claude's
   context.
6. Re-run `runAgent` without `--resume`, prepending the preamble to
   the user's message.
7. Emit a `status` event — "Previous session unavailable — continuing
   with local transcript." — so the UI pause isn't a mystery.

## Out of scope (keep small PR)

- Chat-index summary in the preamble (issue suggested; the jsonl
  replay alone already covers the common case)
- Failure surfacing when the retry *also* fails with the same pattern
  beyond "emit original error" (covered by the one-retry cap + normal
  error path)
- E2E test (would require mocking the real Claude subprocess — added
  to `docs/manual-testing.md` instead)

## File plan

| File | Kind | Purpose |
|---|---|---|
| `server/agent/resumeFailover.ts` | new | `isStaleSessionError`, `buildTranscriptPreamble`, `DEFAULT_TRANSCRIPT_MAX_CHARS` |
| `server/api/routes/agent.ts` | edit | Retry loop in `runAgentInBackground`, `clearClaudeSessionId` helper, `readTranscriptPreamble` helper, `handleAgentEvent` extraction (keeps `runAgentInBackground` under the cognitive-complexity cap after adding the outer `while`) |
| `test/agent/test_resumeFailover.ts` | new | Unit tests for detection + preamble (filtering, truncation, empty-case, default opt) |
| `docs/manual-testing.md` | edit | Smoke-test recipe entry |

## Design notes

**Preamble format** — framed with header + footer so Claude knows
it's being handed a replay, not a user-authored wall of text:

```
[Continuing from an earlier session. The original Claude CLI
session id is no longer available, so the transcript below is
replayed from the local jsonl so you have context.]

[...earlier turns omitted for length...]     ← only when truncated
User: …
Assistant: …
User: …

[End of prior transcript. The user's new message follows.]

<decoratedMessage>
```

**Retry structure** — `while (true) { for await ... if (!staleSessionDetected) break; }`.
`break` abandons the failed generator; since the stale-session
error is yielded only after the CLI exits non-zero, the subprocess
is already dead at that point — no leaked handles.

**Cognitive complexity** — the per-event branching (text append,
tool logging, tool-trace recordEvent) was inlined in
`runAgentInBackground`. Wrapping the body in another loop pushed
complexity over the 15-cap threshold, so the branching lives in a
helper `handleAgentEvent(event, ctx)`. Pure refactor — no behavior
change in the non-retry path.

**Meta file handling** — `clearClaudeSessionId` only removes the key,
preserving every other field (`roleId`, `startedAt`,
`firstUserMessage`, `hasUnread`). The new id lands back via the
existing `updateClaudeSessionId` when the retried run emits its
first `claude_session_id` event. No change to the concurrent-write
safety of meta writes (they were non-atomic before and remain so —
out of scope for this PR).

## Verification

- Unit tests: 18 new cases in `test/agent/test_resumeFailover.ts`
  (detection + 11 preamble cases covering filter / truncation /
  defaults / malformed input).
- Typecheck + lint + build clean.
- Existing 2036 test suite passes.
- Manual smoke recipe in `docs/manual-testing.md` §4 covers the
  end-to-end path against a real Claude CLI.
