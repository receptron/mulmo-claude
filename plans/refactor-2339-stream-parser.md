# refactor(#2339): fold `parseStreamEvent` into `createStreamParser().parse`

Issue: #2339 — `server/agent/stream.ts` holds two parsers for the same stream. The stateful
`parse()` returned by `createStreamParser()` is the one the agent loop runs; the module-level
`parseStreamEvent()` is a hand-copied stateless twin. Its comment says it is "used by tests
and one-off parsing", so the test suite validates a code path production never executes:
adding event handling to `parse()` leaves `parseStreamEvent` stale and the tests still green.

## Step 0 — who actually calls `parseStreamEvent`?

```
$ grep -rn parseStreamEvent --include='*.ts' . | grep -v node_modules | grep -v /dist/
test/agent/test_agent_stream.ts:3,76,82,101,123,140,162,177,187,204,214,220
server/agent/stream.ts:179   (the definition)
```

**Zero production callers.** `server/agent/backend/claude-code.ts` — the only real consumer of
this module — uses `createStreamParser()`. The "and one-off parsing" half of the comment is
stale; the function exists solely to be tested. That makes the duplication strictly worse than
it looks: the second implementation has no user other than the tests that vouch for it.

## Step 1 — is `filterAssistantBlocks(blocks, false)` the identity?

This is the one real divergence the issue flags: `parse()` runs assistant blocks through
`filterAssistantBlocks(blockEvents, textStreamedFromDeltas)`, `parseStreamEvent` returns
`blockEvents` untouched. On a fresh parser `textStreamedFromDeltas === false`.

```ts
function filterAssistantBlocks(blockEvents: AgentEvent[], deltaStreamed: boolean): AgentEvent[] {
  return deltaStreamed ? blockEvents.filter((agentEvent) => agentEvent.type !== EVENT_TYPES.text) : blockEvents;
}
```

**Yes — identity, for every input.** The body is a single ternary on `deltaStreamed` alone.
With `deltaStreamed === false` the false branch returns the _same array reference_: `.filter()`
never runs, nothing is copied, reordered, or dropped. No value of `blockEvents` — empty, all
text, mixed, huge — can reach the filtering branch, because the branch is not selected by
anything about `blockEvents`. This is established by reading the function, not by sampling
inputs; a value-dependent filter would need `blockEvents` in the condition and it is not there.

So the divergence named in the issue is **not** a behaviour difference on a fresh parser, and
delegation is safe with respect to it.

## Step 2 — two _other_ divergences the issue did not name

Delegation swaps the whole body, so equivalence has to hold for every event type, not just the
assistant path. Two cases differ, both in `parse()`'s favour:

| event                                                          | `parse()` on a fresh parser         | old `parseStreamEvent`                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `stream_event` carrying a `content_block_delta` / `text_delta` | `[{ type: text, message: delta }]`  | `[]` — `stream_event` is neither `assistant` nor `user`, so the early return swallows it                                                  |
| `result` with a falsy `result` but a `session_id`              | `[{ type: claude_session_id, id }]` | `[]` — the guard is `event.type === "result" && event.result`, so a resultless event skips the whole block, including the session-id push |

Both are behaviour _changes_, not silent ones: they are recorded here, called out in the PR, and
pinned by tests. The second is a latent bug in the copy — a `session_id` arriving on a
result event with empty text was dropped on the floor. Neither can regress production, because
production never called `parseStreamEvent` (Step 0).

## Decision

`filterAssistantBlocks(blocks, false)` is the identity ⇒ take the delegation branch the issue
proposes. `parseStreamEvent(event)` becomes `createStreamParser().parse(event)` — a fresh
parser per call, which is exactly the "stateless" contract the old body approximated by
copy-paste. The two Step-2 divergences ride along and are documented above.

## Implementation

- `server/agent/stream.ts`: replace the ~22-line duplicated body with the one-line delegation.
  Rewrite the comment to explain _why_ a fresh parser per call (dedup needs one parser across a
  whole turn) rather than restating what the line does.
- `test/agent/test_agent_stream.ts`: keep the existing `parseStreamEvent` cases (they now
  exercise the real parser through the alias) and add blocks that:
  - asserts equivalence event-by-event across `result` (with / without `session_id`), a
    non-`assistant`/`user` type, an `assistant` event mixing text + tool_use + tool_result +
    unrecognised blocks, a `user` event, and `content` absent / not an array;
  - pins the `filterAssistantBlocks` axis from both sides — identical output on a fresh parser,
    and a stateful parser that _has_ streamed deltas dropping the text event that
    `parseStreamEvent` keeps (which is why fresh-per-call is required, not incidental);
  - pins the two Step-2 divergences as the new expected behaviour.

## Verification

Mutation checks (CLAUDE.md: a test proves nothing until the broken code makes it red). Both were
run against the shared implementation and then reverted:

1. **Drop the `"Thinking..."` status prefix** from `parse()` (`return [{status}, ...filtered]`
   → `return filtered`) — 8 tests red, including pre-existing `parseStreamEvent` cases. Those
   only fail if `parseStreamEvent` really routes through `parse()`, so this is the direct proof
   that the delegation is live and that the suite no longer vouches for a second implementation.
2. **Break the identity claim** — make `filterAssistantBlocks` filter unconditionally
   (drop the `deltaStreamed ?` guard) — 6 tests red across both stream test files, including the
   new `filterAssistantBlocks divergence` block. So the Step-1 finding is pinned, not just
   asserted in prose.

Suite green after restore: 50/50 across `test/agent/test_agent_stream.ts` and
`test/agent/test_streamParser.ts`.
