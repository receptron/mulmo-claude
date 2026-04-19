# feat(chat-service): socket.io bridge transport — Phase A

Tracks issue #268.

## Goal

Add a socket.io transport at `/ws/chat` for messaging bridges, alongside
the existing HTTP endpoint at `/api/transports/:transportId/chats/:externalChatId`.
Phase A ships the basic req/res-over-socket surface and migrates the CLI
bridge; Phases B–D follow in separate PRs.

## Context (what changed under us)

Four PRs landed after the first attempt at this work:

- #305 — `chat-service` was refactored into a DI-pure factory
  (`createChatService(deps) → Router`). Phase A plugs into the same
  factory pattern.
- #272 — bearer token auth applies to every `/api/*` request. The socket
  handshake must carry the same token in `auth.token` (validated at
  `io.use`). Non-socket transports stay behind the Express middleware.
- #273 — the route prefix is `/api/transports/:transportId/chats/:externalChatId`.
  The socket event shape is transport-agnostic and doesn't care.
- #311 — pub-sub already switched from raw `ws` to socket.io at
  `/ws/pubsub`. The chat socket reuses the same `socket.io` dep family.

## Why socket.io (not plain `ws`)

- reconnect / heartbeat built-in
- handshake-time auth via `io.use(middleware)` — drops bearer token
  validation in one place for the whole transport
- room concept maps cleanly onto `transportId` for Phase B push
- long-polling fallback means constrained environments (corporate
  proxies, some CI) keep working
- already a dep in main (#311), so zero new packages

We keep the `/ws/pubsub` channel untouched — it's a different protocol
for a different concern (frontend subscribing to server state).

## Event protocol (Phase A)

Socket path: `/ws/chat` (sibling of `/ws/pubsub`).

### Handshake

```ts
io(URL, {
  path: "/ws/chat",
  auth: { transportId: "cli", token: "…" },
});
```

- `auth.transportId` — required, identifies the bridge (`cli`, `telegram`, …)
- `auth.token` — required when the server has a bearer token configured
  (production / `yarn dev`). Tests can construct a service with
  `tokenProvider: undefined` to skip the check.

Rejection cases (server sends `connect_error`):
- `transportId is required`
- `token is required`
- `invalid token`

### Client → server: `message`

```ts
socket.emit(
  "message",
  { externalChatId: "terminal", text: "hello" },
  (reply: { ok: true; reply: string }
         | { ok: false; error: string; status?: number }) => { … },
);
```

Uses socket.io's built-in ack callback — the natural analogue of HTTP
req/res. No custom `reply` event needed yet (Phase C adds `reply.chunk`
in addition, not instead).

### Server → client: none (yet)

Phase B adds `push` for async delivery.

## Scope

### In

1. `server/api/chat-service/relay.ts` — `createRelay(deps) → RelayFn`. Holds
   the shared flow previously inlined in `createChatService`
   (load-or-create state → command handler → startChat → collect reply →
   timestamp update). DI-pure; all host deps arrive through the factory.
2. `server/api/chat-service/socket.ts` — `attachChatSocket(server, deps) →
   SocketServer`. Handshake validates `transportId` and (if configured)
   `token`. The `message` event dispatches through the injected `RelayFn`.
3. `server/api/chat-service/index.ts` — `createChatService(deps)` now
   returns `{ router, attachSocket, relay }`. Both the HTTP route and
   the socket call the same `relay` so there's one place the chat flow
   lives.
4. `server/api/chat-service/types.ts` — add optional `tokenProvider?: () =>
   string | null` to `ChatServiceDeps`.
5. `server/index.ts` — pass `getCurrentToken` (from `server/api/auth/token.js`)
   as `tokenProvider`; call `chatService.attachSocket(httpServer)` after
   `createPubSub(httpServer)`.
6. `bridges/cli/index.ts` — rewrite with `socket.io-client`. Reads
   bearer token with existing `readBridgeToken()` helper and sends it
   as `auth.token`. Logs connect / disconnect / connect_error so the
   user can see what's happening.
7. Tests — `test/chat-service/test_socket.ts` spins up an HTTP server,
   attaches the socket with a stub relay, connects a real client, and
   exercises: happy path, missing transportId, missing token,
   wrong token, payload validation, relay error propagation.
8. Docs — `plans/messaging_layers_guide.md` Layer 2 section mentions
   the socket transport alongside the HTTP endpoint.

### Out (tracked in Phase B/C/D)

- Async server → bridge push (`pushToBridge`, rooms, #263) — Phase B
- Streaming text chunks (`reply.chunk`) — Phase C
- Deprecating the HTTP endpoint — Phase D
- Web UI integration — stays on `/ws/pubsub`

## Compatibility

The HTTP endpoint stays in place with identical behavior (it still goes
through the same `relay` helper). Any bridge that already speaks HTTP
(including external ones) keeps working. The CLI bridge migrates in
this PR because the cost of keeping two CLI paths is higher than the
cost of updating one small script.

## Open items

- `socket.io-client` is already pulled in by the pubsub client path, so
  no new dep. Socket.io version pinning: server and client must match
  major version (both at 4.x, pinned via yarn.lock).
- Auth exposure: the socket inherits the same 401-recovery problem the
  HTTP bridge has (server restart invalidates the token). The CLI logs
  a clear "re-run yarn cli" message on `connect_error` carrying
  `invalid token`.
