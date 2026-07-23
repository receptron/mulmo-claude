# refactor(#2487): single-source the env-option readers in `@mulmoclaude/common`

Two helpers scrape env vars into a `bridgeOptions` bag and differ only in their
prefix scheme and (on one side) an allowlist:

| | file | prefixes (descending precedence) | allowlist |
|---|---|---|---|
| bridges | `packages/client/src/options.ts` — `readBridgeEnvOptions(transportId, env)` | `<TRANSPORT>_BRIDGE_`, `BRIDGE_` | none |
| relay path | `server/events/resolveRelayBridgeOptions.ts` — `resolveRelayBridgeOptions(platform, env)` | `RELAY_<PLATFORM>_`, `RELAY_` | `RECOGNISED_KEYS` (`defaultRole`) |

## What is identical

Line-for-line the same algorithm, only renamed:

1. iterate `Object.entries(env)`, skip non-string / empty-string values;
2. two-prefix scan — specific prefix checked first so it claims a name that also
   matches the shared prefix; an empty tail after the prefix is dropped (and does
   **not** fall through to the shared prefix);
3. `UPPER_SNAKE` tail → `lowerCamel`, adjacent underscores collapsing to one word
   break; empty result dropped;
4. two buckets (`shared`, `specific`) merged with `{ ...shared, ...specific }` so
   the specific prefix wins on key conflict;
5. dashes in the transport / platform id normalised to `_` before uppercasing
   (`google-chat` → `GOOGLE_CHAT`), because dashed env names aren't shell-settable.

## What genuinely differs — and why it must be preserved

1. **The allowlist (security).** Bridges get their secret hygiene *structurally*:
   `SLACK_BOT_TOKEN` has no `_BRIDGE_` segment, so it can never be scraped. The
   relay scheme has no such marker — every `RELAY_*` name is a candidate, and
   `RELAY_TOKEN` (bearer) / `RELAY_URL` live in exactly that namespace.
   `bridgeOptions` is forwarded to the agent and may be logged, so the relay side
   emits only keys in `RECOGNISED_KEYS`. **This is preserved as the optional
   `allowKeys` parameter** — the relay wrapper passes it, the bridge wrapper does
   not (no allowlist = current bridge behaviour, where any `*_BRIDGE_*` key
   travels).
2. **Blank id handling.** `resolveRelayBridgeOptions("", env)` deliberately
   resolves the blanket form only (`platformPrefix` returns `null`).
   `readBridgeEnvOptions("", env)` degrades differently — it builds the unreachable
   prefix `_BRIDGE_`. Both are preserved by having each wrapper build its own
   prefix list; the shared scanner just takes the list it is given.
3. **Runtime.** Neither reader runs inside the Cloudflare Worker: the
   `packages/relay` Worker never reads `bridgeOptions`, and
   `resolveRelayBridgeOptions` is called from `server/events/relay-client.ts` — the
   **host** Node process holding the relay WebSocket. Both call sites are Node, so
   there is no Web-API-vs-Node divergence to preserve. Both helpers are still pure
   (env record in, plain object out) with zero platform APIs, so the shared home
   stays Worker-safe anyway.

Not a difference: the bridge copy's `part ? … : ""` guard inside
`snakeToLowerCamel` is dead code — the preceding `.filter((s) => s.length > 0)`
makes `part` always non-empty. Dropped on consolidation (verified by test).

## Canonical home

`@mulmoclaude/common/env-options` — new subpath in the existing zero-dependency
leaf package.

Downhill for every caller:

- `@mulmobridge/client` already declares `@mulmoclaude/common` (`^1.1.0`) and
  imports `isRecord` from it in `src/http.ts`.
- `@mulmobridge/relay` (the Worker) already declares it too, so if the Worker ever
  needs the scanner the edge is already there.
- the host already re-exports the package wholesale via `server/utils/types.ts`.

So this is not premature consolidation into a new tier — the dependency edge
predates the change. New subpath (not `index.ts`) matches the `./ssrf` and
`./meta-webhook` precedent and keeps the parser out of the guards barrel.

## Parameterisation

```ts
scanEnvOptions(env, { prefixes, allowKeys? }): Record<string, string>
```

`prefixes` is ordered by **descending** precedence; the first prefix a name starts
with claims it, and buckets merge from lowest to highest precedence.
`allowKeys` (a `ReadonlySet<string>` of lowerCamel keys) filters emitted keys when
present. `snakeToLowerCamel` is exported alongside it so the case rule is testable
on its own.

Both existing functions keep their names, signatures, and files; each becomes a
thin wrapper that builds its prefix list (and, for the relay, passes `allowKeys`).

## Verification

- New `packages/common/test/test_env_options.ts` covering the shared scanner:
  happy path, missing var, empty string, malformed value (bare/trailing/repeated
  underscores, empty tail, non-string), precedence boundary, allowlist on/off,
  single-prefix (blank-id) form.
- Both existing suites (`packages/client/test/test_options.ts`,
  `test/events/test_resolveRelayBridgeOptions.ts`) stay as-is and now act as the
  wrappers' contract tests — including the `RELAY_TOKEN` / `RELAY_URL` leak tests.
- Mutation check: dropping `allowKeys` from the relay wrapper must turn the leak
  tests red.

## Versioning

No `@mulmobridge/*` export is added or removed (`packages/client/src/index.ts` is
untouched), so the smoke `drift` gate stays green and no `@mulmobridge/*` bump is
needed. `@mulmoclaude/common` grows a subpath export but is **not** bumped here:
per the repo rule, every declared range must equal the latest *published* version,
and common's bump belongs to the publish flow that actually ships it.
