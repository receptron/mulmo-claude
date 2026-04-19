# Fix: Stale `runStartIndex` Breaks Auto-Select of LLM Text Replies

## Problem

After the first turn in a session that used any plugin (GUI-chat-protocol tool),
subsequent LLM text replies fail to become the selected canvas result. The
user keeps seeing the old plugin output (or, in some edge cases, a blank
"Start a conversation" panel) even though the sidebar shows a fresh text
reply from the assistant.

## Expected Behavior

When an assistant text reply arrives from the LLM during a run:

- **Select it** (make it the active canvas result) if no plugin result
  has landed during the **current** run.
- **Do NOT select it** if a plugin result has already landed during the
  current run — the plugin output is visually richer and should remain
  selected.

This rule MUST hold **on every turn**, not just the first turn after the
session is subscribed. Run N+1 must not be influenced by plugin results
emitted during run N.

## Root Cause

`ensureSessionSubscription` in `src/App.vue` (around line 1431) is
idempotent — if a subscription already exists for the session, it returns
early:

```ts
function ensureSessionSubscription(session, runStartIndex): void {
  if (sessionSubscriptions.has(session.id)) return;   // ← early return
  const ctx: AgentEventContext = {
    session,
    runStartIndex,   // ← captured once in closure
    ...
  };
  const unsub = pubsubSubscribe(channel, (data) => {
    ...
    applyAgentEvent(event, ctx);   // ← stale ctx reused forever
  });
  sessionSubscriptions.set(session.id, unsub);
}
```

`beginUserTurn` (around line 1416) computes a fresh `runStartIndex`
(= `session.toolResults.length` after the user message is pushed) on
every turn, and `sendMessage` passes it to `ensureSessionSubscription`
— but on turn 2+ the early return discards it. The `ctx` object created
on turn 1 remains the one that every future `applyAgentEvent` call sees.

Consequence: `shouldSelectAssistantText(toolResults, ctx.runStartIndex)`
(in `src/utils/agent/toolCalls.ts`) scans results starting from turn 1's
start index. Once any plugin result exists anywhere at or after that
stale index, the function returns `false` forever — so new assistant
text cards on turn 2, 3, 4, … are never selected automatically.

## Fix (Option 2: move `runStartIndex` onto the session)

Store `runStartIndex` on the `ActiveSession` object itself instead of
closure-capturing it inside the subscription. The event handler already
has a reference to `session`, so reading a fresh value from there is
trivial and avoids rebuilding the subscription on every turn.

### Changes

1. **`ActiveSession` type** — add a field:

   ```ts
   interface ActiveSession {
     ...
     runStartIndex: number;
   }
   ```

   Initialize to `0` (or `toolResults.length`) wherever an `ActiveSession`
   is constructed:
   - `createNewSession` (around line 1249)
   - `loadSession` (around line 1362)

2. **`beginUserTurn`** (`src/App.vue` around line 1416) — write the index
   onto the session and return it for the caller that still expects it:

   ```ts
   function beginUserTurn(session: ActiveSession, message: string): number {
     session.updatedAt = new Date().toISOString();
     session.toolResults.push(makeTextResult(message, "user"));
     session.runStartIndex = session.toolResults.length;
     return session.runStartIndex;
   }
   ```

3. **Text event handler in `applyAgentEvent`** (around line 1585) — read
   from the session, not from `ctx`:

   ```ts
   if (shouldSelectAssistantText(session.toolResults, session.runStartIndex)) {
     session.selectedResultUuid = textResult.uuid;
   }
   ```

4. **Drop `runStartIndex` from `AgentEventContext`** (around line 1497)
   and from `ensureSessionSubscription`'s signature. Update both call
   sites (`sendMessage` around line 1633 and `loadSession` around line
   1381) to pass only the session.

5. **Tests** — add a case to the existing `toolCalls` unit tests that
   asserts `shouldSelectAssistantText` is called with the per-turn
   index. Add an E2E or integration test for the two-turn scenario:

   - Turn 1: user asks something that triggers a plugin, LLM also sends
     text. Assert plugin is selected.
   - Turn 2: user asks a text-only follow-up, LLM replies with text.
     Assert the new text card is selected (this is the regression
     this fix addresses).

## Why Option 2 over Option 1

Option 1 would be to drop the idempotent guard and rebuild `ctx` on
every turn — but the subscription callback has already closed over the
old `ctx`, so that doesn't help without further restructuring (mutable
ref boxes, manager objects, etc.). Option 2 is a ~10-line diff that
keeps the subscription lifecycle untouched and puts the per-turn state
where it belongs: on the session object the event handler already
reads from.

## Out of Scope

- The separate "Start a conversation" symptom where `selectedResultUuid`
  points to a uuid not in the current session's `toolResults` (e.g.
  URL `?result=` carrying a stale uuid across session switches). That
  is a different dangling-reference bug and should be tracked in its
  own plan.
- Any change to `shouldSelectAssistantText`'s algorithm. The current
  "any plugin in run → don't select" rule is correct; the bug is that
  it's being called with the wrong `runStartIndex`.
