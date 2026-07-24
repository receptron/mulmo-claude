# feat: Advertise host capabilities to the remote client

## Problem

The remote-host command channel has **no mechanism for the host to tell the
remote what it can do**. The handler table (`server/remoteHost/handlers/index.ts`)
is the only source of truth for which methods the host serves, and the remote
learns it purely from the **hardcoded contract both repos compiled against**.

That means the remote can't tell whether *this particular* host build actually
serves a given method — a self-hosted install may be an older version, or ship a
plugin that adds/drops a capability. Today the remote finds out only by firing a
command and getting an `unknown_method` error back after a full round trip, and
its UI can't adapt (e.g. hide a "send photo" affordance when `startChat` is
absent) because it has no capability signal.

## Decision (locked)

- **Transport: the presence doc (push), not a `getCapabilities` command (pull).**
  The remote already runs an `onSnapshot` listener on `users/{uid}/hosts/{hostId}`
  for online/offline. Advertising capabilities there means the remote knows the
  full set the instant the host is online — zero extra round trip, and it can
  gate UI *before* issuing any command. A pull command would cost a round trip
  and couldn't inform the UI until after connect.
- **Granularity: method names + a protocol version**, not rich per-method
  descriptors. Covers the real need (feature gating) and matches how the handler
  table is already keyed. Rich descriptors (param schema / read-write / labels)
  are a possible future bump of `protocolVersion`, not v1.
- **Auto-derived, not a second list.** `capabilities = Object.keys(handlers)` off
  the live handler table, so registering a handler is the only step to advertise
  it — no drift, same discipline as the handler table itself. Fixes both hosts
  (MulmoClaude + MulmoTerminal) at once since the runner lives in core.

## Contract (both repos depend on exactly this)

Presence doc `users/{uid}/hosts/{hostId}` payload, written on every heartbeat:

```jsonc
{
  "online": true,                 // false on stop / fatal listener death
  "hostId": "mulmoclaude",
  "protocolVersion": 1,           // REMOTE_HOST_PROTOCOL_VERSION
  "capabilities": ["listCollections", "getCollection", "startChat", …],
  "updatedAt": "<serverTimestamp>" // not part of the capability contract
}
```

Browser-safe exports from `@mulmoclaude/core/remote-host` (both repos compile
against them): `HostPresence`, `REMOTE_HOST_PROTOCOL_VERSION`,
`buildHostPresence(channel, handlers, online)`.

## Host-side implementation (this repo — shipped)

- `packages/core/src/remote-host/index.ts` — add `REMOTE_HOST_PROTOCOL_VERSION`,
  the `HostPresence` interface, and the pure `buildHostPresence` builder
  (`capabilities = Object.keys(handlers)`).
- `packages/core/src/remote-host/server/hostRunner.ts` — replace the three
  `setDoc(presence, {online, updatedAt})` calls with a single `writePresence(online)`
  that spreads `buildHostPresence(...)` + `updatedAt: serverTimestamp()`. So the
  announce heartbeat and both offline paths all carry the capability set.
- `packages/core/test/remote-host/test_presence.ts` — unit tests for the pure
  builder (keys → capabilities, hostId/version, online flag, empty table).
- `docs/remote-host.md` — presence diagram + "Capability advertisement" section.

No host-local change under `server/remoteHost/` is needed: the runner already has
the handler table, so capabilities flow for free.

## Cross-repo follow-up (mulmoserver — NOT this repo)

The mobile client consumes the new browser-safe exports to read `capabilities`
off its existing presence listener and gate UI. It depends on a **published**
`@mulmoclaude/core` carrying `HostPresence` / `REMOTE_HOST_PROTOCOL_VERSION`, so
this contract is only usable cross-repo after a `@mulmoclaude/core` publish
(local host advertising works immediately via workspace linking).

## Non-goals

- No `getCapabilities` pull command (presence push is sufficient for v1).
- No per-method schema / read-write / label descriptors — a future
  `protocolVersion` bump if a self-describing remote UI ever needs it.
- No host discovery / registry — `hostId` stays hardcoded as today.
