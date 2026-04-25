# feat(relay): per-platform default role via `RELAY_<PLATFORM>_DEFAULT_ROLE`

Issue: [#739](https://github.com/receptron/mulmoclaude/issues/739)
Pattern reference: [#729](https://github.com/receptron/mulmoclaude/pull/729) (bridges' `<TRANSPORT>_BRIDGE_DEFAULT_ROLE`)

## Problem

`@mulmobridge/relay` (Cloudflare Workers webhook proxy) forwards messages from LINE / WhatsApp / Messenger / Google Chat / Teams into the host app's `server/events/relay-client.ts`. That client calls `relay({ transportId, externalChatId, text })` with no `bridgeOptions`. The chat-service-side `resolveDefaultRole` already handles `bridgeOptions.defaultRole` — landed in #729 for bridges — but no code feeds it for the relay path. Result: relay-routed users always start in the workspace's default role, with no way to pin a per-platform default. Asymmetric with native bridges and #729's UX.

## Scope

Host-app side only:

1. New helper `server/events/resolveRelayBridgeOptions.ts` — pure mapping `(platform, env) → BridgeOptions`. Per-platform `RELAY_<PLATFORM>_<KEY>` overrides blanket `RELAY_<KEY>`.
2. Wire it into `server/events/relay-client.ts`'s `relay({ ... })` call.
3. Unit tests covering the env resolution order, platform-name normalisation (dashes → underscores), and missing/empty cases.
4. README addition under `packages/relay/` documenting the env scheme. Source unchanged — **no cascade publish**.

## Out of scope

- Cloudflare Worker source under `packages/relay/src/` — the worker forwards `msg.platform` already; nothing to change there.
- Per-platform options other than `defaultRole` (e.g. a hypothetical `RELAY_LINE_SOURCEWATCH`). The helper's design accepts arbitrary keys, so when a use-case lands the env scheme already supports it.
- Updating bridges' equivalent helper (`packages/client/src/options.ts`). That stays in `@mulmobridge/client` because each bridge is a 1-platform process. The relay helper lives in MulmoClaude because relay multiplexes platforms inside one process.

## Design

### Env scheme

```
RELAY_DEFAULT_ROLE=general               # blanket fallback for every platform
RELAY_LINE_DEFAULT_ROLE=line-support     # LINE-only override
RELAY_WHATSAPP_DEFAULT_ROLE=sales        # WhatsApp-only override
RELAY_MESSENGER_DEFAULT_ROLE=support
RELAY_GOOGLE_CHAT_DEFAULT_ROLE=internal  # platform `google-chat` → uppercase + dashes-to-underscores
RELAY_TEAMS_DEFAULT_ROLE=enterprise
```

Per-platform override beats blanket on conflict, mirroring bridges' transport-specific-over-shared rule.

The platform set is `PLATFORMS` from `packages/relay/src/types.ts`: `line`, `telegram`, `slack`, `discord`, `messenger`, `mattermost`, `zulip`, `whatsapp`, `matrix`, `irc`, `google-chat`, `teams`. The helper accepts any string — if a future relay version adds a platform, the env mechanism keeps working without code changes here.

### Helper signature

```ts
export function resolveRelayBridgeOptions(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string>;
```

- Returns the same shape `readBridgeEnvOptions` returns (lowerCamel keys) so `bridgeOptions` consumers don't care which side produced the bag.
- Empty object when no relevant env vars are set — `relay()` accepts `bridgeOptions` as optional, but always passing the bag (even empty) keeps the call site uniform.
- `platform` is normalised the same way bridges normalise transport ids: uppercase + dashes-to-underscores. So `google-chat` reads `RELAY_GOOGLE_CHAT_*`.

### Wiring

`server/events/relay-client.ts` line 191 today:

```ts
const result = await relay({
  transportId: TRANSPORT_ID,
  externalChatId,
  text: msg.text,
});
```

Becomes:

```ts
const result = await relay({
  transportId: TRANSPORT_ID,
  externalChatId,
  text: msg.text,
  bridgeOptions: resolveRelayBridgeOptions(msg.platform, process.env),
});
```

That's the entire production-code change.

### Why not reuse `readBridgeEnvOptions`?

The bridges helper assumes one process = one transport. For relay we have one process forwarding multiple platforms, so the prefix is `RELAY_<PLATFORM>_*`, not `<TRANSPORT>_BRIDGE_*`. The two helpers parallel each other but the prefix logic differs. Extracting a shared `parseEnvBag(prefix, env, normalisePrefix)` is tempting but premature — let's land #739 mirroring the existing helper's shape, and revisit consolidation only if a third caller appears.

## Verification

- Unit tests in `test/events/test_resolveRelayBridgeOptions.ts`:
  - `RELAY_DEFAULT_ROLE` only → returns `{ defaultRole: "general" }`
  - `RELAY_LINE_DEFAULT_ROLE` only → returns `{ defaultRole: "line-support" }` for `platform="line"`, empty for other platforms
  - both set → per-platform wins
  - dashes in platform name → reads underscored env (`google-chat` → `RELAY_GOOGLE_CHAT_*`)
  - empty / undefined env vars → ignored
  - unrelated env vars (`RELAY_TOKEN`, `RELAY_URL`) → must NOT leak into bridgeOptions (they end with `_TOKEN` / `_URL`, not part of any `*_DEFAULT_ROLE` pattern, but the test pins it)
  - blank platform string → returns blanket-only resolution
- `yarn test` covers it because `test/` already runs every `test/**/test_*.ts`.
- Manual: set `RELAY_LINE_DEFAULT_ROLE=test-role`, run a fake LINE webhook through relay, verify the new chat session lands in `test-role`. (Documented in the README addition for downstream operators.)

## Execution order

1. Plan doc (this file) committed first.
2. `server/events/resolveRelayBridgeOptions.ts` + `test/events/test_resolveRelayBridgeOptions.ts`.
3. Wire into `relay-client.ts`.
4. README addition.
5. Format / lint / typecheck / build / test gate. Push, open PR.
