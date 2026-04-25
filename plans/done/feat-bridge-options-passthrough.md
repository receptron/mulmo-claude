# feat: bridge options passthrough

## Problem

Bridges (Slack / Telegram / Mastodon / ...) currently have no way to customise the server's behaviour beyond the wire fields (`externalChatId`, `text`, `attachments`). The immediate pain point is role selection: every new bridge session on Slack starts with the default role (`general`), and the user has to run `/role slack` via the bridge command handler every time. Setting `SLACK_DEFAULT_ROLE=slack` on the bridge process would be the natural fix, but the client library has no mechanism to forward such a hint to the server, and the protocol has no slot for "bridge-specific configuration".

There's a second concern: `@mulmobridge/client` is a generic library, not a MulmoClaude-specific one. Hard-coding keys like `defaultRole` into the protocol would bleed app concerns into the transport layer. Another app hosting the same client should be able to define its own options (`initialPrompt`, `channelTopic`, `maxTokens`, whatever) without needing a protocol release.

## Goal

Add a generic **opaque options bag** that flows `bridge env → client → chat-service → app callback`. The protocol knows the bag exists but nothing about its contents; the host app is free to look up whatever keys it cares about. Naming and forwarding rules live in the client library so every bridge gets the mechanism for free.

## Shape

### Env var convention

```text
SLACK_BOT_TOKEN=xoxb-…             # internal: consumed by the bridge itself
SLACK_APP_TOKEN=xapp-…             # internal
SLACK_ALLOWED_CHANNELS=C123,C456   # internal
SLACK_BRIDGE_DEFAULT_ROLE=slack    # forward → options.defaultRole  (slack only)
BRIDGE_DEFAULT_ROLE=general        # forward → options.defaultRole  (any bridge)
```

Rules the client library implements:

- Scrape any env whose name matches `^<TRANSPORT>_BRIDGE_([A-Z0-9_]+)$` (per-transport) or `^BRIDGE_([A-Z0-9_]+)$` (shared default across bridges).
- The captured tail is `UPPER_SNAKE` → the option key is `lowerCamel`. `SLACK_BRIDGE_DEFAULT_ROLE` → `defaultRole`. `SLACK_BRIDGE_PAGE_SIZE_MAX` → `pageSizeMax`. `BRIDGE_FOO_BAR` → `fooBar`.
- Transport-specific vars win over the shared `BRIDGE_*` one when both are set for the same key.
- Values are kept as raw strings — the app does its own parsing (int / bool / csv). No type coercion at the transport layer.
- Empty values are dropped (so `SLACK_BRIDGE_FOO=` doesn't shadow `BRIDGE_FOO=x`).

The `_BRIDGE_` segment is deliberately noisy: it marks the env var as "this gets forwarded to the app", keeping internal secrets (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, …) naturally outside the scrape because they have no `_BRIDGE_` segment. This removes the need for each bridge to maintain a reserved-env list.

### Wire

Options travel on the **handshake**, not on every message — this is per-bridge-instance config, not per-turn state. The socket.io handshake already carries `auth: { transportId, token }`; add `options?: Record<string, unknown>`:

```ts
// @mulmobridge/protocol — additive, backward-compatible
export interface BridgeHandshakeAuth {
  transportId: string;
  token?: string;
  /** Opaque bag passed through to the host app's startChat
   *  callback. Protocol doesn't interpret any keys. */
  options?: Readonly<Record<string, unknown>>;
}
```

Chat-service stashes `socket.data.options = handshake.auth.options ?? {}` on connect and forwards it to every `RelayFn` call (same lifetime as `transportId`).

### Client

```ts
// @mulmobridge/client
import { readBridgeEnvOptions, createBridgeClient } from "@mulmobridge/client";

const options = readBridgeEnvOptions("slack", process.env); // returns {} if no matches
const mulmo = createBridgeClient({
  transportId: "slack",
  options,           // or omit — extracted automatically if absent
});
```

If `options` is omitted in `createBridgeClient`, the library calls `readBridgeEnvOptions(transportId, process.env)` itself. Bridges that want custom logic (e.g. merge env + a YAML file) pass an explicit bag and skip the default scrape.

### App-side (MulmoClaude)

`RelayFn`'s params gain a `bridgeOptions?: Readonly<Record<string, unknown>>` field. The Relay forwards it into `StartChatParams.bridgeOptions`. Server `startChat` interprets **`bridgeOptions.defaultRole`** specifically:

- On session **creation** (`chat-state-store.resetChatState(...)`), if the bridge supplied a valid, resolvable `defaultRole` string, use it instead of the global `DEFAULT_ROLE_ID`.
- On **existing** sessions (`chatState` already present), do NOT override — the user may have explicitly switched roles with `/role <id>` and we respect that.
- An unknown role id in `defaultRole` falls back silently to `DEFAULT_ROLE_ID` with a warn-level log ("bridge requested role X, not found; using default"). No error, no rejection — the bridge user shouldn't see a 500 for a typo in their own env.

Other `bridgeOptions.*` keys are ignored by MulmoClaude today; a different host app could read them without any change to protocol/client/chat-service.

## Migration

1. **Protocol**: bump `@mulmobridge/protocol` minor with the additive `auth.options` field + exported type. No breaking change; old clients just don't send it.
2. **Client**: add `readBridgeEnvOptions(transportId, env)` pure helper + unit tests. Wire into `createBridgeClient` as a default. Ship patch/minor bump.
3. **Chat-service**: extract `options` from handshake, store on `socket.data`, thread through `RelayFn` + `RelayParams` + `StartChatFn`. Unit test the plumbing with a fake bridge emitter.
4. **Server**: extend `StartChatParams.bridgeOptions` (already has `origin`, `userTimezone`); in relay default-role assignment path, prefer `bridgeOptions.defaultRole` on session creation. Existing sessions unaffected.
5. **Slack bridge** (first user): README gets a `SLACK_BRIDGE_DEFAULT_ROLE` row. No code change needed because the client library auto-scrapes.
6. **Docs**: `docs/bridge-protocol.md` gets a "Bridge options" section. The skill `.claude/skills/publish-mulmoclaude/SKILL.md` doesn't need changes; the package cascade flow still picks up the new protocol/client versions via the existing drift check.
7. **Cascade publish**: `@mulmobridge/protocol` → `@mulmobridge/chat-service` → `@mulmobridge/client` → `mulmoclaude`. Tracked by `/publish-mulmoclaude` §2.

## Out of scope

- Type-checked options — we keep the bag `Record<string, unknown>` to avoid forcing every new key through a cross-package release. Each host app can define its own typed accessor if it wants compile-time checks on its own side.
- Runtime option updates (hot-reload from env on SIGHUP etc.) — the handshake captures config once at connect time, same lifecycle as `transportId`. A bridge restart is the refresh mechanism.
- Validation on the server side beyond "is the role id resolvable?" — any host app introducing a new `bridgeOptions.*` key owns its own validation.
- Per-message option overrides — plausible future extension (add `options` to the `message` event too), but YAGNI until a concrete use case surfaces.

## File list

- `packages/protocol/src/socket.ts` — add `BridgeHandshakeAuth` exported type.
- `packages/client/src/options.ts` — new `readBridgeEnvOptions` helper.
- `packages/client/src/client.ts` — wire options into handshake + default scrape.
- `packages/client/src/index.ts` — re-export `readBridgeEnvOptions`.
- `packages/chat-service/src/socket.ts` — read + stash `auth.options`, pass into relay.
- `packages/chat-service/src/relay.ts` — thread `bridgeOptions` into RelayParams + StartChat call.
- `packages/chat-service/src/types.ts` — extend StartChatParams typing.
- `server/api/routes/agent.ts` — accept `bridgeOptions` in StartChatParams; log on role resolve failure.
- `packages/bridges/slack/README.md` — document `SLACK_BRIDGE_DEFAULT_ROLE`.
- `packages/client/test/test_options.ts` (new) — env scrape rules, precedence, camelCase mapping, empty drop.
- `packages/chat-service/test/test_resolveDefaultRole.ts` (new) — defaultRole honoured on new sessions, unknown role warn + fallback, non-string input ignored.
- `packages/chat-service/test/test_sanitiseOptions.ts` (new) — wire-contract enforcement: only flat primitives survive; nested objects / arrays / non-finite numbers / prototype-polluting keys are dropped.
