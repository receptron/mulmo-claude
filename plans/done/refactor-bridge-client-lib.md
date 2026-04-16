# refactor: extract bridge client library + protocol reference

## Goal

Prepare for the second bridge (Telegram, coming in a follow-up PR)
by extracting the socket.io setup currently inlined in
`bridges/cli/index.ts` into a reusable helper, and writing a
protocol reference document so future bridges — including non-Node
implementations — have a single place to look.

## Why now

With only one bridge (CLI), we've been operating on the "premature
abstraction is worse than duplication" principle. The Telegram
bridge is next, with a real user. Two bridges is the right time to
pull out the parts that are definitely shared (token loading,
handshake, connect/disconnect logging, send-with-ack, push
listener) and leave platform-specific code (readline vs
getUpdates-loop) in the bridge file.

## Scope

### In

1. `bridges/_lib/client.ts` — `createBridgeClient({ transportId })`
   returns:
   - `send(externalChatId, text) → Promise<MessageAck>` — emit a
     `message` with ack, 6-minute timeout
   - `onPush(handler)` — subscribe to `push` events (Phase B)
   - `onConnect(handler)` / `onDisconnect(handler)` — lifecycle
     hooks for platform-specific behavior (e.g. Telegram's
     typing-indicator on reconnect, CLI's connect banner)
   - `close()` — explicit shutdown
   - `socket` — escape hatch for raw `socket.on(...)` / internals

   Internally:
   - Reads token via `readBridgeToken()`; exits with a helpful
     error if absent
   - `io(apiUrl, { path: "/ws/chat", auth: { transportId, token },
     transports: ["websocket"] })`
   - Default logging (connect id, disconnect reason,
     connect_error). Recognises
     `invalid token` / `server auth not ready` and prints the
     "server likely restarted — re-run the bridge" recovery hint.
2. `bridges/_lib/token.ts` — moved from `bridges/cli/token.ts` as-is
   (no code changes; the bridge re-exports nothing, the `_lib` file
   is the new canonical location).
3. `bridges/cli/index.ts` — rewritten on top of `_lib/client.ts`.
   End state: ~50 lines of readline + glue, down from ~110.
4. `docs/bridge-protocol.md` — implementer-facing reference:
   - Transport (socket.io 4.x on `/ws/chat`)
   - Auth flow (bearer token, `.session-token` / env var)
   - Handshake shape + rejection reasons
   - Events: `message` (client→server with ack) and `push`
     (server→client, Phase B)
   - Error strings bridges should recognise
   - Minimal TypeScript example (the same contract the _lib
     implements, so non-Node implementers can follow the same
     shape)

### Out

- Telegram bridge itself — follow-up PR, tracks own issue
- `bridges/_template/` skeleton directory — premature until
  Telegram exposes what a template should look like
- Tests for `_lib/client.ts` — the server side is already tested in
  `test/chat-service/test_socket.ts`; a client-side test would
  largely duplicate it. CLI bridge's manual smoke test (`yarn dev`
  + `yarn cli`) is the integration gate for now. If the Telegram
  bridge reveals a need (e.g. reconnect race), add tests then.

## Compatibility

- The CLI bridge's user-visible behavior is unchanged — same
  prompts, same error messages, same recovery hints. Only the
  internals moved.
- Phase B's `push` listener (introduced in PR #318) slots in
  naturally: `client.onPush((ev) => console.log(...))`. Once #318
  merges, the CLI gets push-aware without touching `_lib/client.ts`
  again.
