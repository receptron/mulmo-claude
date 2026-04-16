# feat(chat-service): socket.io bridge transport — Phase A

Tracks issue #268.

## Goal

Replace the HTTP req/res bridge transport with a bidirectional WebSocket
(socket.io) channel. Phase A delivers the basic req/res-over-socket surface
and migrates the CLI bridge; Phases B–D (async push, streaming, HTTP
deprecation) are out of scope for this PR.

## Why socket.io (not plain `ws`)

- reconnect / heartbeat built-in
- handshake-time auth (future #267-style token fits naturally into
  `io.use(middleware)` without code changes elsewhere)
- room concept maps cleanly onto `transportId` for Phase B push
- long-polling fallback means constrained environments (corporate proxies,
  some CI) keep working

We keep the existing `ws`-based `/ws/pubsub` channel untouched — it's a
different protocol for a different concern (frontend subscribing to server
state), and conflating the two would just couple two independent surfaces.

## Event protocol (Phase A)

Socket path: `/ws/chat` (sibling of `/ws/pubsub`).

### Handshake

```ts
io(URL, { path: "/ws/chat", auth: { transportId: "cli" } });
```

- `auth.transportId` — required, identifies the bridge (`cli`, `telegram`,
  …). Server rejects the connection if missing.
- `auth.token` — reserved for future auth integration (ignored in Phase A).

### Client → server: `message`

```ts
socket.emit(
  "message",
  { externalChatId: "terminal", text: "hello" },
  (reply: { ok: true; reply: string } | { ok: false; error: string; status?: number }) => { … },
);
```

Acknowledgement callback form (socket.io's built-in ack) — the reply arrives
on the same socket but through the callback, which is the natural translation
of the current HTTP req/res flow. No custom `reply` event needed yet (Phase C
will add `reply.chunk` on top, not instead).

### Server → client: none (yet)

Phase B adds `push` for async delivery.

## Scope

### In

1. `yarn add socket.io socket.io-client`.
2. `server/chat-service/socket.ts` — socket.io server factory. Export
   `attachChatSocket(httpServer)` which wires `/ws/chat`, validates the
   handshake, and dispatches `message` through the same `startChat` +
   `collectAgentReply` flow the HTTP endpoint uses.
3. Extract the shared reply flow (load-or-create chat state → command check
   → `startChat` → `collectAgentReply` → state timestamp update) into a
   helper so HTTP and socket paths share one implementation.
4. `server/index.ts` — call `attachChatSocket(httpServer)` from
   `startRuntimeServices` next to `createPubSub`.
5. `bridges/cli/index.ts` — rewrite with `socket.io-client`. Same REPL UX
   (type a line, get a reply), just over socket. Logs reconnect / disconnect
   events so the user can tell when the server goes away.
6. Tests:
   - `test/chat-service/test_socket.ts` — spin up an HTTP server, attach the
     socket, connect a real `socket.io-client`, emit `message`, assert the
     ack body. Uses a stubbed `startChat` so no Claude runs.
   - Handshake-rejection test: no `transportId` → `connect_error`.
7. Docs: update `plans/messaging_layers_guide.md` Layer 2 section.

### Out (tracked in Phase B/C/D)

- Async server → bridge push (`pushToBridge`, rooms, #263) — Phase B
- Streaming text chunks (`reply.chunk`) — Phase C
- Removing the HTTP endpoint — Phase D
- Web UI integration — stays on `/ws/pubsub`
- Auth (#267 was closed NOT_PLANNED; design accommodates it via
  `io.use` if revived)

## Compatibility

The existing HTTP endpoint stays in place and behaves exactly as before.
External bridges that already speak HTTP keep working. Only the CLI bridge
(which nobody else depends on yet) migrates in this PR.

## Risk / open items

- `socket.io-client` brings a larger dep surface than `ws`. Acceptable for a
  design doc-level decision from the issue; revisit only if size regressions
  show up in the built client bundle (we don't bundle the server).
- Socket.io version pinning: pick the latest 4.x; server and client versions
  must match major.
