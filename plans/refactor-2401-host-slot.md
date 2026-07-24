# refactor(core): unify the host-adapter slot boilerplate — #2401

## Problem

The host-adapter (logger / workspaceRoot injection) skeleton is copy-pasted
across three files inside the same package (`@mulmoclaude/core`):

- `packages/core/src/collection/server/host.ts`
- `packages/core/src/feeds/server/host.ts`
- `packages/core/src/google/host.ts`

Each holds a host-injected binding in a module-level singleton, exposes a
`configure*Host()` setter, a required getter that throws-if-unset, and a
forwarding `log` proxy. All in one package — pure copy-paste, no
dependency-direction excuse (jscpd flagged 100/99/98-token clones).

## Behaviour audit (before)

| domain | required getter unset | `configure*` re-bind to *different* | **logger proxy when unset** | reset-for-test |
|---|---|---|---|---|
| collection | throws (`getWorkspaceRoot` etc.) | throws | **silent no-op** (`current?.log`) | none |
| feeds | throws (`requireFeedsHost`) | throws | **THROWS** (`requireFeedsHost().log`) | `resetFeedsHostForTesting` (exported, unused) |
| google | n/a (no required getter) | **silent overwrite** | **silent no-op** (`silentLogger` default) | none |

### Inconsistencies found

1. **Logger proxy when the host is unset**: `feeds` THROWS, while `collection`
   and `google` silently drop. `collection`'s own comment documents the
   canonical rationale: logging is non-critical, so calls before the host is
   wired are dropped rather than throwing — unlike `getWorkspaceRoot()`, which
   fails loudly because the engine cannot operate without a workspace root.
2. **Re-bind protection**: `collection` + `feeds` throw when re-configured with
   a *different* host; `google` silently overwrites.

## Canonical decision

- Required-getter unset → **throw** (with the domain name). Unchanged.
- Logger proxy unset → **silent no-op** (the documented, deliberate choice).
- Re-bind to a *different* value → **throw**; same value → no-op.

## Design

New internal module `packages/core/src/host/hostSlot.ts` (not a package export):

- `interface StructuredLogger` — the shared `(prefix, message, data?)` shape
  (structurally identical to `CollectionLogger` / `FeedsLogger` / `GoogleLogger`,
  which stay declared+exported per-domain so the public surface is untouched).
- `createHostSlot<T>(name)` → `{ set, get, peek, reset }`:
  - `set(v)` — re-bind to a different value throws (`${name} was already called with a different host`); same value no-op.
  - `get()` — returns the value, or throws (`${name} was not called by the host`) if unset. Backs the required getters.
  - `peek()` — value or `null`, never throws. Backs the logger proxy.
  - `reset()` — clears (test-only).
- `createForwardingLogger(getLogger)` — builds the 4-method proxy over
  `() => StructuredLogger | null`; drops calls when the getter returns null.
  Centralised so no domain can drift into throwing where a sibling drops.

The domain files keep their own typed interfaces + domain-specific fields:
- collection keeps the SEPARATE optional `changePublisher` slot untouched
  (nullable, no throw — a genuinely-optional pub/sub hook, a different contract).
- feeds keeps `AgentWorkerRunner`/`spawnWorker`/`writeFileAtomic`.
- google keeps its logger-only binding (its token handling lives in other files).

Error messages preserved exactly for collection + feeds by passing
`name = "@mulmoclaude/core/<domain>: configure<X>Host()"`.

## Behaviour changes (called out)

1. **feeds `log`**: throw → silent no-op when the host is unset. Aligns feeds to
   the canonical collection/google behaviour; strictly safer (pure-logic unit
   tests no longer blow up on a stray log). Never reachable in production
   (`configureFeedsHost` runs at boot); no test relies on the throw.
2. **google `configureGoogleHost`**: silent overwrite → throw on re-bind to a
   *different* logger. Defensive + consistent; unreachable in the current code
   (configured exactly once at server startup, verified repo-wide).

## Bump decision

All exported names, types, and signatures are identical. The two behaviour
changes only affect never-occurring edge states (unconfigured feeds log; google
double-config), so no real consumer flow changes. Proposing **no version bump**
in this PR (keeps the launcher-sync gate green and avoids the ~50-consumer range
sweep for a behaviour-preserving refactor). Flagged for reviewer sign-off.

## Tests

`packages/core/test/host/test_hostSlot.ts` (core tests run `tsx --test` against
source, so no rebuild needed for these):

- factory: get-before-set throws with the domain name; set-then-get resolves;
  peek is null-before / value-after; double-set same value no-op; double-set
  different value throws; reset clears.
- forwarding logger: no-op before a logger is available; forwards after.
- per-domain smoke: collection (`getWorkspaceRoot` throws→resolves, log no-ops
  unset), feeds (`requireFeedsHost` throws→resolves, reset clears, log no-ops
  unset = the fixed behaviour), google (log no-ops unset→forwards, re-bind
  different throws).

Verify-by-reverting: break `get()` to return the value without throwing, confirm
the get-before-set test goes RED, restore.

## Gate

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.
