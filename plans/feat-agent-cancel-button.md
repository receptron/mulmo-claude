# Cancel button for in-flight agent runs (#731, partial)

## Goal

Add a visible Stop button that appears while an agent is running, so a
user can interrupt a long task without page reload. Quickest of the
three subtasks #731 listed; tackled first because backend already
supports it and the user-pain (no way to abort) is highest.

## Non-goals

- Elapsed-time / current-tool indicator (the second proposal in #731)
- Mid-flight additional instructions (the third proposal — needs SDK
  research and design discussion first)
- Per-tool cancel / partial undo
- Confirmation dialog before cancelling. The action is recoverable
  (the user can just send the message again) so an extra click would
  be friction, not safety.

## Existing infrastructure

Already in place — frontend just needs to drive it:

- `POST /api/agent/cancel { chatSessionId }` route in
  `server/api/routes/agent.ts:84`. Returns `{ ok: boolean }`.
- `cancelRun(chatSessionId)` in `events/session-store/`. Bound to the
  per-run `AbortController` registered by `beginRun()`.
- `API_ROUTES.agent.cancel = "/api/agent/cancel"` already published in
  `src/config/apiRoutes.ts`.

## Design

### ChatInput.vue

The send button is currently `:disabled="isRunning"`. Replace the
disabled-fade with a *swap*: while running, render a Stop button in
the same slot. Click emits a new `cancel` event up to the parent.
Same swap for the expanded-editor send button.

Visual: red (`bg-red-600`), Material icon `stop`, same shape as the
send button so the layout stays stable. `data-testid="stop-btn"` and
`data-testid="expanded-stop-btn"` for E2E.

The textarea stays disabled while running — typing during a cancel
race would be confusing. The Stop button is the only interactive
element until `isRunning` flips back to false.

### App.vue

New handler `cancelRun()`:

```ts
async function cancelRun(): Promise<void> {
  if (!currentSessionId.value) return;
  await apiPost<{ ok: boolean }>(API_ROUTES.agent.cancel, {
    chatSessionId: currentSessionId.value,
  });
}
```

Wired as `@cancel="cancelRun"` on both ChatInput instances (single +
stack layout). No optimistic UI flip — the SSE stream will close and
the existing `isRunning` watcher will reset state when the abort
propagates back through the agent loop.

### i18n

New key `chatInput.stop` (label + tooltip) in all 8 locales per
project rules. Localized:

| locale | label |
|---|---|
| en | Stop |
| ja | 停止 |
| zh | 停止 |
| ko | 정지 |
| es | Detener |
| fr | Arrêter |
| de | Stoppen |
| pt-BR | Parar |

## Testing

- New unit test isn't strictly needed — ChatInput is a thin shell;
  the new code path is "render different button + emit different
  event". The cancel endpoint itself already has its happy path.
- E2E coverage: extend an existing chat-flow spec to verify the
  Stop button appears during streaming and the cancel POST is
  issued. Defer if the existing harness doesn't easily mock
  long-running streams; the manual test plan in the PR covers it.

## Manual test plan

1. Start a long-running agent task (e.g. a role with multiple tool
   calls)
2. Verify Stop button appears in place of Send while running
3. Click Stop → agent run terminates, `isRunning` flips back to
   false, Send button returns
4. Send message again → works normally (no leftover state)
5. Open Network tab — confirm `POST /api/agent/cancel` fires once
   per click

## Out of scope (follow-ups for #731)

- Progress indicator (elapsed time, current tool) — separate PR
- Mid-flight additional instructions — needs design discussion
