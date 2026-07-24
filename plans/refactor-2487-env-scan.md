# refactor: consolidate bridge/relay env scanning into `@mulmoclaude/common` `scanEnvOptions` (#2487)

## Problem

`readBridgeEnvOptions` (`packages/client/src/options.ts`) and `resolveRelayBridgeOptions`
(`server/events/resolveRelayBridgeOptions.ts`) implement the same env-scrape algorithm twice
(jscpd alerts #174 / #175): two-tier prefix scan, specific-wins precedence via spread order,
empty-value drop, `UPPER_SNAKE` → `lowerCamel`. The only real differences are:

1. the prefix sets (`<TRANSPORT>_BRIDGE_` / `BRIDGE_` vs `RELAY_<PLATFORM>_` / `RELAY_`), and
2. the relay side's `RECOGNISED_KEYS` allowlist that keeps `RELAY_TOKEN` / `RELAY_URL`
   secrets out of `bridgeOptions`.

Both are parameterisable. `@mulmoclaude/common` is a declared dependency of
`@mulmobridge/client` and reachable from the host, so the consolidation target already sits
on the dependency graph — the "premature consolidation" header note in the relay file no
longer holds (verified in #2487).

## Plan

1. New `packages/common/src/envScan.ts` exporting:
   - `snakeToLowerCamel(snake)` — the shared casing helper (the client copy's
     `part ? … : ""` ternary is dead code behind the non-empty `filter` and is dropped).
   - `scanEnvOptions(env, { prefixes, allowKeys? })` — prefixes ordered LOW → HIGH
     precedence (later wins per key); the highest-precedence matching prefix CLAIMS a var
     (an empty tail drops it without retrying lower prefixes — both originals behave this
     way); empty-string values dropped; `allowKeys` (lowerCamel `ReadonlySet`) filters
     emissions when present.
   - Re-exported from common's `index.ts` (same integration as `toUtcIsoDate`). No version
     bumps in this PR.
2. `readBridgeEnvOptions` → thin wrapper: builds the transport prefix, calls
   `scanEnvOptions` with `prefixes: ["BRIDGE_", transportPrefix]`, no `allowKeys`.
   Public signature and returned shape unchanged.
3. `resolveRelayBridgeOptions` → thin wrapper: `prefixes: ["RELAY_", "RELAY_<PLATFORM>_"]`
   (blanket only when the platform normalises to empty) + `allowKeys: RECOGNISED_KEYS`.
   Header updated: the "kept separate to avoid premature consolidation" paragraph is
   superseded; it now points at the shared scanner and states the allowlist rationale
   (secrets exclusion).
4. Tests:
   - Port both sides' unit tests onto `scanEnvOptions` in
     `packages/common/test/test_env_scan.ts`, plus boundary tests: precedence, empty-value
     drop, empty tail, claim-no-fallthrough, no-prefix-match, allowKeys filtering,
     `snakeToLowerCamel` cases.
   - Keep the wrapper-level tests (`packages/client/test/test_options.ts`,
     `test/events/test_resolveRelayBridgeOptions.ts`) untouched.
   - Mutation check the security test: temporarily remove the `allowKeys` filter in
     `envScan.ts`, confirm the `RELAY_TOKEN`/`RELAY_URL`-never-leaks tests go red, restore.
5. `docs/shared-utils.md`: catalog row for `scanEnvOptions` (Bridges section).
6. Gates: `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`; jscpd
   with the CI ignore string confirms alerts #174/#175 gone and no new clones.

## Behavioral equivalence notes

- **Per-key precedence**: originals bucket into `shared` / `specific` and return
  `{ ...shared, ...specific }`. The scanner buckets by prefix index and merges LOW → HIGH,
  which is the same merge. Within one bucket, env iteration order decides (last write wins)
  — preserved via a stable sort on precedence.
- **Claim semantics**: in both originals the higher-precedence prefix is tested first and
  RETURNS on match — a specific-prefix match with an empty tail yields `null` without
  falling through to the shared prefix (`SLACK_BRIDGE_` / `RELAY_LINE_` are dropped, not
  re-read as `BRIDGE_…`-style tails). The scanner reproduces this: highest matching prefix
  claims the name; an empty tail drops it outright.
- **Overlapping prefixes**: `RELAY_LINE_DEFAULT_ROLE` textually matches both `RELAY_LINE_`
  and `RELAY_`; the platform prefix claims it (checked first), so it never also lands in the
  blanket bucket as `lineDefaultRole`. Pinned by a test.
- **Empty-value drop** and **allowlist position** (after camelisation, before bucketing)
  are unchanged.
