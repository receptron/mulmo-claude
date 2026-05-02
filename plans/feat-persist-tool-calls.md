# feat: persist `tool_call` events to session jsonl (#1096)

Optionally write the `tool_call` event side of the
in-memory `toolCallHistory` to the same session jsonl that
already holds `tool_result`. Off by default, on via
`PERSIST_TOOL_CALLS=1` env var.

## Why this is a separate flag (not always-on)

- args can be very large — a single `presentMulmoScript` call
  carries the whole script JSON; image tools can carry inline
  base64 in `args`. Default-on would bloat session files.
- Privacy: args sometimes contain content the user wouldn't
  expect to land on disk in this exact form (vs a redacted
  result they already see). Surprising to make this default.
- The existing `DISABLE_SANDBOX` flag is the precedent for
  "debug-mode env var, off in production".

## Schema

One JSONL line per `tool_call` event, mirroring the existing
`tool_result` shape:

```json
{"source":"agent","type":"tool_call","toolUseId":"toolu_01...","toolName":"presentMulmoScript","args":{...},"timestamp":1717200000000}
```

Fields match `ToolCallHistoryItem` in `src/types/toolCallHistory.ts`
plus a `source: "agent"` discriminator and a `type` event tag, so
existing jsonl parsers see a familiar shape.

## Implementation slices

### 1. `server/system/env.ts`

Add the flag, mirroring `disableSandbox`:

```ts
// Opt-in debug aid: persist `tool_call` events to the session
// jsonl alongside `tool_result`. See plans/feat-persist-tool-calls.md
// for the rationale (off by default — args can be large + carry
// inline payloads).
persistToolCalls: asFlag(process.env.PERSIST_TOOL_CALLS),
```

### 2. `server/events/session-store/index.ts`

In `applyEventToSession`'s `EVENT_TYPES.toolCall` branch (~L321),
when `env.persistToolCalls`, fire-and-forget append to the
session's `resultsFilePath`:

```ts
if (type === EVENT_TYPES.toolCall) {
  session.toolCallHistory.push({
    toolUseId: event.toolUseId as string,
    toolName: event.toolName as string,
    args: event.args,
    timestamp: Date.now(),
  });
  if (env.persistToolCalls) {
    void persistToolCallEvent(session.resultsFilePath, event).catch((err) => {
      log.warn("session-store", "persist tool_call failed (non-fatal)", {
        chatSessionId: session.chatSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
```

Helper `persistToolCallEvent` is a small async function that
writes the line in the schema above.

The `void … .catch(…)` shape keeps the parent function sync (it
already is) and matches the pattern used elsewhere in the file
for fire-and-forget writes.

### 3. Tests

`test/events/test_session_store.ts` already covers the in-memory
path. Add a focused module:

`test/events/test_persistToolCalls.ts` — two cases:

- env flag off → `applyEventToSession(toolCall)` produces NO
  jsonl write (file unchanged).
- env flag on → exactly one `tool_call` line appended with the
  expected shape.

Use a real tmp file (the existing tests already use mkdtemp).

### 4. Docs

- `server/workspace/helps/sandbox.md` — add a short section
  "Debug aids" listing both `DISABLE_SANDBOX` and the new
  `PERSIST_TOOL_CALLS` (cross-link to this plan + issue #1096).
- 8 language READMEs (`README.md`, `README.ja.md`, `README.fr.md`,
  `README.de.md`, `README.zh.md`, `README.es.md`, `README.pt-BR.md`,
  `README.ko.md`) — append the `PERSIST_TOOL_CALLS=1` example
  next to each existing `DISABLE_SANDBOX=1` example, with a
  one-sentence explanation.

## Out of scope (this PR)

- **Replay on reload** — `src/utils/session/sessionEntries.ts:113`
  always sets `toolCallHistory: []` on session load. With persisted
  `tool_call` lines we COULD reconstruct it, but that touches the
  parser + protocol type and is its own design exercise. File a
  follow-up after this lands.
- **Redaction** — args can carry inline payload bytes. Documenting
  the privacy note in the help is enough for v1.
- **Schema versioning** — same JSONL shape as existing events.
  Older readers ignore unknown `type` values.

## Acceptance

- [ ] `PERSIST_TOOL_CALLS=1 yarn dev`: a chat with one tool call
  produces one `tool_call` line + one `tool_result` line in the
  jsonl.
- [ ] Default `yarn dev`: same chat produces only the
  `tool_result` line (unchanged behaviour).
- [ ] Tests pass for both branches.
- [ ] Docs updated in lockstep across 8 locales.

## References

- Issue: #1096
- Related: PR #1083 (`feat(sidebar): use ToolResult.action for
  multi-feature labels`) — recently confirmed the gap that
  motivated this issue ("toolCallHistory is SSE-only and isn't
  persisted with the chat log").
