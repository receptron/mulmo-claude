# Notification push scaffold — time-delayed fan-out to Web + Bridge

## Motivation

We now have all the primitives needed for server → user async push:

- **Bridge side** (#268 Phase B): `chatService.pushToBridge(transportId, chatId, message)` — one-to-one, offline-queued
- **Web side**: existing `pubsub.publish(channel, payload)` over the `/ws/pubsub` socket

The in-app notification center (#144) and external-channel notifications (#142) are both full features in their own right. Before committing to either, we want a **minimum viable scaffolding** that lets us:

1. Trigger a test push from anywhere (curl, a future plugin, task-manager)
2. Observe the push arrive on Web (pub-sub subscriber) *and* on Bridge (CLI print / Telegram sendMessage) simultaneously
3. Prove the end-to-end timing and connection behaviour

This PR builds that scaffolding and nothing more.

## Scope

Covered:
- `POST /api/notifications/test` endpoint — accepts message + delay, schedules fan-out
- In-memory `setTimeout` scheduler (no persistence — fine for a PoC)
- Fan-out to both: `pubsub.publish(PUBSUB_CHANNELS.notifications, …)` + `chatService.pushToBridge(transportId, chatId, …)`
- Unit tests (fake timers)
- Developer docs with curl recipe

Deferred (out of scope):
- UI (toast / bell icon / notification center — lives in #144)
- External-channel forward (Telegram / Slack — lives in #142)
- Task-manager integration (cron-style / persisted schedule)
- Per-user / per-session routing
- Dedup / snooze / dismissal state
- Fan-out to *all* connected bridges (needs explicit transport registry — defer until a caller needs it)

## Design

**Trigger surface**

```
POST /api/notifications/test
Authorization: Bearer <token>            ← normal bearer-auth layer
Body: {
  message?: string,        // default "Test notification"
  delaySeconds?: number,   // default 60, capped to 3600
  transportId?: string,    // default "cli" — bridge target
  chatId?: string          // default "notifications" — bridge chat slot
}
→ 202 Accepted { firesAt: ISO8601, delaySeconds: number }
```

**Fan-out (fires after delay)**

```ts
pubsub.publish(PUBSUB_CHANNELS.notifications, {
  message,
  firedAt: new Date().toISOString(),
});
chatService.pushToBridge(transportId, chatId, message);
```

Both calls are synchronous-ish (fire-and-forget at the socket layer). Bridge queue handles offline case (see Phase B). Web subscribers that aren't connected miss the push — acceptable for a PoC; `pubsub` has no store-and-forward semantics today.

**Why `setTimeout` not task-manager**

Task-manager is an interval runner (`schedule: { type: "interval", intervalMs }`) — it's not a one-shot scheduler. For a test scaffolding, `setTimeout` in-memory is the right tool: simple, abortable on process exit, no persistence cost. When #144 ships the real notification center it will likely need persistence and at that point the scheduler should move into task-manager or a new `server/events/scheduled/` module.

**Why no UI in this PR**

The ask was "push テストとして … 作りたい". The goal is proving the fan-out works end-to-end. UI for notifications is #144's scope and will land in a separate PR. Web developers can observe the push via the browser DevTools socket inspector in the meantime; bridge developers see it via `yarn cli` printing `[push] …`.

## File plan

| File | Kind | Purpose |
|---|---|---|
| `server/events/notifications.ts` | new | `scheduleTestNotification(opts, deps)` — pure scheduler with DI so tests don't need a live HTTP server |
| `server/api/routes/notifications.ts` | new | `POST /api/notifications/test` handler, validates body, defers to the scheduler |
| `server/index.ts` | edit | Mount the route, inject `pubsub.publish` + `chatService.pushToBridge` |
| `src/config/apiRoutes.ts` | edit | Add `notifications.test` |
| `src/config/pubsubChannels.ts` | edit | Add `notifications` channel (subscriber list starts empty — populated by #144) |
| `test/notifications/test_scheduler.ts` | new | Fake timers (`node:test` `t.mock.timers`) + publish/push spies, covering default / override / cap / fire-once |
| `docs/developer.md` | edit | New "Notifications (scaffold)" section — curl recipe, fan-out diagram, pointers to #144 / #142 for productionisation |

## Testing

**Unit** (this PR):
- `test/notifications/test_scheduler.ts` — covers the `scheduleTestNotification` helper against spied dependencies:
  - fires publish + push exactly once after the stated delay
  - default delay is 60_000ms
  - caps delay at 3_600_000ms when given larger input
  - fires on zero-delay (synchronous flush on next microtask)
  - passes the right payload shape to publish / the right `(transportId, chatId, message)` to push

**Manual** (see `docs/developer.md` addition):
- `yarn dev` + `yarn cli` side-by-side
- curl the endpoint with `delaySeconds: 5` for quick feedback
- Observe: CLI prints `[push] notifications: …` after the delay; browser DevTools Network → `/ws/pubsub` frame shows the inbound `notifications` event

**No E2E**: nothing to click in the UI yet. Added to `docs/manual-testing.md` if warranted during implementation (likely not — a pure curl-vs-server check).

## Rollout

This endpoint is auth-protected by the existing bearer token. Leaving it permanently enabled is fine — it's harmless (just echoes a string), rate-limited by the attacker having to know the server's token, and becomes the foundation for the production notification API under #144.

If at any point we decide to remove it in favour of the production API, the route file / channel constant / helper all delete cleanly (one place each).
