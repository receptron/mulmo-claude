# feat: strict lockstep for launcher ↔ workspace + gui-chat-protocol peer chain

## Summary

Follow-up to #1923 (initial `launcherSync.mjs`). Adds two stricter invariants:

- **workspace-lockstep (invariant 4)**: launcher's `@mulmoclaude/*` / `@mulmobridge/*` range lower bound MUST equal the workspace source version (exact match). Prevents launcher lag when a workspace pkg bumps but launcher doesn't ratchet its range.
- **peer-dep-lockstep (invariant 5)**: for protocol-critical peer deps (currently `gui-chat-protocol` only), plugin peer range lower bound major.minor MUST equal launcher pin major.minor. Enforces the user's "gui-chat-protocol update 時に必ず依存追従" requirement — future protocol bumps at 1.0+ get caught even if `satisfies` returns true.

Fixes 2 real drifts uncovered by the strict gate:

- Launcher `@mulmobridge/chat-service`: `^0.1.2` → `^0.1.7` (workspace is 0.1.7, launcher lagged 5 patches)
- Launcher `@mulmobridge/client`: `^0.1.4` → `^0.1.5` (workspace is 0.1.5, launcher lagged 1 patch)
- Root `@mulmobridge/client`: `^0.1.4` → `^0.1.5` (kept in sync with launcher per invariant 1)

## Items to Confirm / Review

- [ ] **peer-dep-lockstep scope** — currently limited to `gui-chat-protocol` via `LOCKSTEP_PEER_DEPS` set. If we want zod / vue / express also strict, extend the set. Kept narrow to avoid forcing plugin republishes for peer ranges plugin authors intentionally keep wide.
- [ ] **workspace-lockstep on all workspace deps** — invariant 4 applies to every workspace pkg the launcher references (`@mulmoclaude/*` + `@mulmobridge/*`). Any workspace bump now REQUIRES a matching launcher-side range bump in the same PR. Additional PR overhead but keeps the launcher's dist always pointing at the newest source.
- [ ] **Real repo self-check** currently passes with the 3 drift fixes above. If someone bumps a workspace pkg mid-PR without touching the launcher, the gate will fire — that's the intended workflow.

## User Prompt

> package.json, root と packages/mulmoclaude/以下が乖離しないようにする
> packages/mulmoclaude/package.json で、モノレポ内で参照しているもので、バージョンを追従するようにする
> gui-chat-protocol が update された場合、かならず依存で追従するようにする
> これを、ci 等で機械的に判定したい。

## Why the two new invariants

The existing gate (#1923) had 3 invariants:

1. root ↔ launcher common dep range identical
2. workspace source **satisfies** launcher range (loose — `^0.1.4` accepts workspace 0.1.5 as still-satisfying, no bump required)
3. plugin peer **satisfies** launcher pin (loose — same class of "already works but stale")

The user's ask is stricter: they want the launcher and the workspace to **ratchet together**. Adding:

4. workspace source **equals** launcher range lower bound (exact) — no launcher lag allowed
5. protocol-critical peer dep major.minor **equals** launcher pin major.minor — gui-chat-protocol contract stays in lockstep

Invariant 4 catches the class where launcher's dist keeps pointing at an older published tarball even after the workspace source has moved forward (invisible in dev because yarn symlinks, visible only after `npm publish`).

Invariant 5 catches the class going forward: once `gui-chat-protocol` reaches 1.0, the caret-range widening (`^1.4.0` accepts `1.5.0`) would let plugin peer stay at `^1.4.0` while launcher moves to `1.5.0` — invariant 3 alone would pass, but the plugin was authored against 1.4's contract. Invariant 5 forces the peer to bump.

For 0.y.z (the current regime), caret semantics happen to make invariant 3 already catch minor drift, so invariant 5 is a forward-compat guardrail that fires cleanly once we're at 1.0+.

## Non-protocol peers stay wide

Plugin peer deps like `zod`, `vue`, `express` are intentionally kept wide by plugin authors (e.g. `zod: ^4.3.6` accepts anything from 4.3.6 to 5.0.0-exclusive) so the plugin can compose with hosts on different minor lines. Forcing lockstep here would create unnecessary republish churn on every host-side minor bump. Invariant 5 is scoped via `LOCKSTEP_PEER_DEPS` — currently just `gui-chat-protocol`.

The looser invariant 3 still catches "peer range does NOT satisfy launcher pin" for all peer deps, so any actual break gets flagged regardless of lockstep policy.

## Implementation

- `scripts/mulmoclaude/launcherSync.mjs` — 2 new finding kinds (`workspace-lockstep`, `peer-dep-lockstep`) + `LOCKSTEP_PEER_DEPS` set
- `scripts/mulmoclaude/launcherSync.d.mts` — type sidecar updated with new FindingKind values
- `test/scripts/mulmoclaude/test_launcherSync.ts` — 5 new tests (workspace-lockstep pass + fail, peer-dep-lockstep pass + fail + non-protocol-peer bypass)
- `package.json` — `@mulmobridge/client` `^0.1.4` → `^0.1.5` (drift fix)
- `packages/mulmoclaude/package.json` — `@mulmobridge/chat-service` `^0.1.2` → `^0.1.7`, `@mulmobridge/client` `^0.1.4` → `^0.1.5` (drift fixes)

## Test plan

- [x] `yarn tsx --test test/scripts/mulmoclaude/test_launcherSync.ts` (17 pass — 12 existing + 5 new)
- [x] `node scripts/mulmoclaude/launcherSync.mjs` — clean
- [x] `yarn format` / `yarn lint` (0 errors) / `yarn typecheck` / `yarn build`
- Manual: intentional workspace bump without matching launcher bump → gate fires with `workspace-lockstep` finding

## Out of scope

- Cascade-publishing `@mulmobridge/chat-service@0.1.7` / `@mulmobridge/client@0.1.5` — those workspace pkgs already published earlier; the launcher's range was simply behind. Bumping the launcher range doesn't need a fresh publish of those packages.
- Extending `LOCKSTEP_PEER_DEPS` beyond `gui-chat-protocol` — no evidence yet that zod / vue / express need it; can add on demand.
