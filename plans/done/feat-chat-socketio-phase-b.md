# feat(chat-service): server → bridge async push — Phase B of #268

Resolves (together with #315) the design discussed in #263.

## Goal

Let server-side code (task-manager, scheduler, future notification
plugins) push a message to a specific bridge chat without waiting for
the user to send something first. Example use cases (from #263):

- "Every morning at 08:00, post the daily brief to the Telegram chat."
- "Security advisory just fired critical — push to the CLI and LINE
  bridges immediately."
- "Long-running image generation finished — tell the bridge the user
  asked from."

Phase A shipped the socket transport but only in the
user-initiated direction (bridge emits `message`, server replies via
ack). Phase B adds the inverse direction.

## Design

### Room model

When a bridge connects with `transportId=telegram`, it joins the
socket.io room `bridge:telegram`. One room per transport, not per
chat — individual chat addressing is done inside the emit payload.
Multiple sockets (same transportId) all receive the push, which maps
correctly to the "CLI bridge running in two terminals" case.

Rationale for one-room-per-transport (vs per-chat):

- Bridges already own the "platform chatId → session" mapping. They
  know how to dispatch within their transport.
- A per-chat room would require bridges to join N rooms for N chats,
  and the server to know every chat up front. The transport-level
  room keeps Layer 3 ignorant of platform specifics (same design
  principle as the rest of chat-service).

### Queue for offline bridges

A bridge may be offline when a push fires (restart, platform outage,
network blip). An in-memory FIFO queue per `transportId` catches the
message; on the next socket connection into that transport's room,
the queue drains to the joining socket.

In-memory, not persisted, because:

- Persistence crosses the package-contract boundary (would need a
  new dep or shell out to `writeFileAtomic`) — fine for a later
  phase.
- Server restart loses the queue, which is the same behavior other
  in-flight state has in this app. Acceptable for Phase B.
- The common case (bridge stays connected most of the time) is
  already solved by the live-push path.

A later phase can swap the queue for a durable implementation without
changing the `pushToBridge` call site.

### Wire protocol

Server → bridge, on `/ws/chat`:

```ts
socket.emit("push", { chatId: string, message: string });
```

No ack. Push delivery is best-effort at the socket layer; bridges
that care about confirmation should add a `push.ack` callback in a
later phase.

### Server-side API

Exposed from `createChatService(deps)` as
`chatService.pushToBridge(transportId, chatId, message)`:

- If sockets exist in `bridge:${transportId}`: `io.to(room).emit("push", …)`
- Else: append to the in-memory queue for that transport. Queued
  messages flush to the first socket that joins the room.

## Scope

### In

1. `server/api/chat-service/push-queue.ts` — DI-pure
   `createPushQueue()` returning `{ enqueue, drainFor, sizeFor }`.
   Keeps `Map<transportId, Message[]>` internally.
2. `server/api/chat-service/socket.ts`:
   - Bridges join `bridge:${transportId}` in the `io.use` pass-through
     (right after auth).
   - On connection, flush any queued messages for that transportId to
     *that specific socket* (so a late-joining second bridge doesn't
     get duplicate deliveries of messages the first bridge already
     drained).
   - Export `createPushEmitter(io, queue, logger)` that returns
     `pushToBridge`.
3. `server/api/chat-service/index.ts` — `createChatService` returns
   `pushToBridge` on the `ChatService` interface. Before `attachSocket`
   is called, `pushToBridge` enqueues only (no live emit).
4. `bridges/cli/index.ts` — listen for `push` events, render as
   `[push] <chatId>: <message>`.
5. `test/chat-service/test_push_queue.ts` — unit tests for the queue.
6. `test/chat-service/test_push.ts` — integration tests: live push,
   offline-then-reconnect flush, multi-socket distribution, ordering.
7. Docs: `plans/done/messaging_layers_guide.md` Layer 2/3 notes include the
   push direction.

### Out (Phase C / D / separate follow-ups)

- Persistent queue — Phase B.2 if/when durability becomes a
  requirement. API stays the same.
- Streaming (`reply.chunk`) — Phase C.
- Global Vue notifications — separate concern, likely extends pubsub
  with a non-session-scoped channel.
- Push ack / retry — Phase B.2 or later.
- HTTP-endpoint push variant — not planned; socket is the one path.

## Compatibility

- `createChatService(deps)` already returns a factory object; adding
  `pushToBridge` is additive — existing callers unaffected.
- Phase A socket clients that don't listen for `push` (e.g. the old
  CLI binary before this PR's update) just ignore the event. No
  protocol break.

## Open items

- Queue eviction policy: currently unbounded. Reasonable at the
  scales we care about (<100 msg per transport idle period). Revisit
  if a bridge stays offline long enough to matter.
- `pushToBridge` is synchronous (`void` return). Callers that want to
  await "delivered" need the ack extension above.
