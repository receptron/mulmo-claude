# The `handlePermission not found` family — full case matrix & regression map

Canonical record of every way the `mulmoclaude` MCP broker can be unavailable, the
fix, and the regression test that pins it. When the broker doesn't come up, the
agent loses **every** `mcp__mulmoclaude__*` tool at once, so the CLI reports the
missing `--permission-prompt-tool mcp__mulmoclaude__handlePermission` rather than
the real cause. One symptom, many causes — this table keeps them straight.

Three layers:

- **Layer 1 — broker dies at LOAD** (permanent `MODULE_NOT_FOUND`; fails on every
  manual retry). A dependency the broker imports is unreachable inside the mount
  layout. Deterministic → fully unit-testable from the shipped builders.
- **Layer 2 — broker loses the STARTUP RACE** (transient; succeeds on a manual
  retry). The broker boots too slowly to connect before the CLI's first tool call.
  Timing → mitigated, not eliminated.
- **Layer 3 — the CLI in the image is STALE** (permanent until the user clears the
  Docker build cache). Our side is healthy; the consumer of the broker is an old
  binary that predates the upstream fix. Environmental → documented, not fixed.

## Layer 1 — mount / resolution (permanent). Status: FIXED + TESTED

Everything routes through `server/agent/config.ts` builders; tests derive their
expectations from those same builders (`test/agent/test_agent_config.ts`, unless noted).

| # | Platform | Layout | Mode | Root cause without the fix | Fix (function) | Regression test |
|---|----------|--------|------|-----------------------------|----------------|-----------------|
| A | any | npx packaged | Docker | `server`/`src` mounted from `projectRoot` → empty `/app/server`, broker script absent (#1770) | mount `server`/`src` from `packageRoot` | L359 "uses packageRoot for server/src …" |
| B | any | npx packaged | Docker | `/app/packages` source dir absent → `docker run` errors on missing mount (#1770) | skip `packagesMount` when `packages/` absent | L375 "skips the /app/packages mount …" |
| C | any | dev, cwd = pkg dir | Docker | `process.cwd()` = pkg dir → empty `node_modules` mounted → `Cannot find module 'express'` (#1770) | `resolveProjectRoot()` anchors via `require.resolve('express')` | L476 "default projectRoot resolves to a populated node_modules …" |
| D | **Windows** | dev source | Docker | yarn `@scope/*` junctions store `C:\…`, dangle in Linux container (#1946) | `workspaceModuleMounts` → `-v <pkg>:/app/pkg_modules/@scope/name`; `NODE_PATH=/app/node_modules:/app/pkg_modules` | L404, L1030, L66/L1012 |
| E | **Windows** | dev source | Docker | CJS `require()` in the container ignores the ESM-only fallback (#1982/#1995) | `--import <mcp-esm-bootstrap>` registers a resolver hook | L76/L1017 + `test/agent/test_mcp_esm_loader.ts` |
| F | **Windows** | dev source | Docker | fallback covered only `@mulmoclaude/*` → `@mulmobridge/*` dangled (#2052) | `scopedPackageName` accepts any `@scope/`; `workspacePackageDirs` walks the tree; loader drops its hardcoded scope | L1048 "covers non-@mulmoclaude scopes", L1058 "skips unscoped launcher" |
| G | **any incl. macOS** | npx packaged | Docker | npm nests deps in `packageRoot/node_modules`; only `projectRoot/node_modules` is mounted (#2056) | `nestedNodeModulesMount` → `-v <packageRoot>/node_modules:/app/pkg_modules` | L446 (npx), L458 (dev negative) |
| H | macOS / Linux | dev source | Docker | none — POSIX symlinks resolve inside the container | n/a (no `/app/pkg_modules` per-pkg mounts) | L419 "does NOT add /app/pkg_modules on non-Windows" |
| I | any | any | **native (no Docker)** | none — host resolution is used directly | no `NODE_PATH`, no `--import`, local `tsx` + local server path | L70, L92, L1024 |

**End-to-end guard (Layer 1, real container):** `.github/workflows/docker_sandbox_windows.yaml`
boots the *real* `mcp-server.ts` from a Windows host (WSL2 + native `dockerd`) with the
shipped mounts/env/argv and asserts `handlePermission` comes back over the MCP handshake.
Covers D–F end-to-end on real NTFS junctions. Schedule + `workflow_dispatch` only.

### Layer 1 mutual-exclusivity (why the fixes can't collide)

- `workspaceModuleMounts` (D/F) is `win32 && packages/ exists` → dev-Windows only.
- `nestedNodeModulesMount` (G) is `packageRoot !== projectRoot && packageRoot/node_modules exists` → npx only.
- npx has no `packages/`; dev has `packageRoot === projectRoot` and no nesting.
- So at most one of the two `/app/pkg_modules` schemes is ever active. Both pinned (L446/L458 + L419).

## Layer 2 — startup race (transient). Status: FIXED + TESTED

| # | Trigger | Platform | Fix | Test | Status |
|---|---------|----------|-----|------|--------|
| J | same-minute fan-out (5 tasks at 20:00 UTC) floods CPU, broker boots slowly | any incl. macOS | stagger independent firings by `firingStaggerMs` (default 1s) | `packages/core/test/scheduler/test_scheduler.ts` stagger cases | **FIXED (mitigation)** |
| K | single-task cold-boot race (broker slower than the first tool call even with 1 task) | any incl. macOS | detect `handlePermission not found` → wait 3s → replay the turn once | `test/agent/test_mcpBrokerFailover.ts` + `test/agent/test_abort_caused_exit.ts` | **FIXED (self-recovery)** |
| L | scheduler records the run `"success"` on spawn, not on turn outcome → silent failures | any | record the real outcome from the turn's completion hook, not at dispatch | `test/skills/test_skill_scheduler.ts` (#2057 error-run case) | **FIXED (honest logging)** |

### J — stagger (`packages/core/src/scheduler/task-manager.ts`)

`runTick` no longer fires all independently-due tasks in one event-loop turn; each starts
`index * firingStaggerMs` later (default 1s, injectable `sleep`). Cuts the concurrent-spawn
contention that delays broker boot. Only helps *multi*-task ticks — a single task fires at
index 0 with zero delay, which is why K is needed too.

### K — retry (`server/agent/mcpBrokerFailover.ts` + `agent.ts` fail-over loop)

`isMcpBrokerNotReadyError` matches the CLI's `(passed via --permission-prompt-tool) … not found`
phrase (both markers required, so an unrelated "not found" never triggers a replay). The
fail-over loop (`runAgentStreamWithFailover`, mirroring the stale-`--resume` recovery) detects it,
waits `BROKER_RECONNECT_WAIT_MS` for the broker to connect, and replays the same turn once —
budget independent of `--resume`, so it works on the fresh sessions scheduled runs use. Replay is
safe because the failed first tool call executed nothing. Mode-A coverage (the CLI logs the error
but exits 0 because the model gave up): `claude-code.ts` surfaces the phrase from stderr as an
error event even on a clean exit (`brokerNotReadyErrorEvent`), so the loop can act on it.

### L — honest logging (`scheduled-run.ts` + `finalizeRun`)

`fireScheduledChat` used to `recordExternalRun` right after `startChat` returned — i.e. at spawn,
so a run that spawned but failed its turn logged `"result":"success"` with an 8 ms duration. Now a
dispatch failure is still recorded immediately, but a successful dispatch records the REAL outcome
(and real duration) from the turn's completion hook. `finalizeRun` fires the one-shot completion
hook for visible origins too (it was hidden-worker-only), a no-op when none is registered.

## Layer 3 — stale CLI in the sandbox image (permanent). Status: DOCUMENTED, NOT FIXED

| #   | Trigger                                                                                                                        | Platform | Fix                                                                       | Test                              | Status                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------- | --------------------------------- | -------------------------- |
| M   | `Dockerfile.sandbox` installs `@anthropic-ai/claude-code` unpinned; the image freezes it and no upstream release retriggers a rebuild (`ensureSandboxImage()` keys on the Dockerfile SHA). CLI < 2.1.206 crashes on `--permission-prompt-tool` before the broker connects (#2202, surfaced by #2201) | any      | none in-repo — user runs `yarn sandbox:remove && docker builder prune -a -f` | none (environmental, not in CI)   | **DOCUMENTED (no code fix)** |

### M — why deleting the image isn't enough

`docker rmi` drops the image but not the **build cache**, so the rebuild reuses the cached
`npm install -g` layer (`CACHED`, 0.0s) and reinstalls nothing. Only `docker builder prune -a -f`
invalidates it. Diagnose with `docker run --rm --entrypoint claude mulmoclaude-sandbox --version`
— the host's `claude --version` says nothing about what's in the image.

Pinning the CLI was proposed (#2202 remedy 1) and **deliberately declined**: it trades a silently
stale CLI for a silently outdated pin, and makes every upstream fix wait on a repo edit. The
consequence is accepted — this case stays live and is handled by documentation
(`packages/core/assets/helps/error-recovery.md`, `docs/developer.md`). If it keeps costing users
time, the better follow-up is a staleness *check* (warn when the in-image version is behind npm's
latest), not a pin.

## Verdict

- **Layer 1 is done and regression-locked** across every platform × layout × mode combination
  (A–I), plus a real-container Windows e2e for the junction cases.
- **Layer 2 is done and tested:** J (stagger) cuts multi-task contention, K (retry) self-recovers
  the single-task race that stagger can't touch, L (honest logging) makes any residual failure
  visible instead of a false success. All three ship with regression tests.
- **Layer 3 (M) is open by choice** — no code fix, documented recovery only. The family is
  therefore *not* fully closed; a `handlePermission not found` report that survives a manual
  retry and shows no `Cannot find module` should be checked against M before reopening A–L.

## Residual note

The race ultimately lives inside the Claude CLI (it spawns our broker AND issues the first tool
call; there is no host-side broker-readiness gate — confirmed: `validateStdioPackages` is
fire-and-forget over third-party npx servers, and the broker's `runtimeReady` gates plugin tools
while `handlePermission` already answers without it, #1698). So K is a bounded *self-recovery*
(one replay), not a guarantee; a further hardening would be to shrink the broker's cold-boot
window by deferring its heavy top-level imports so stdio answers `initialize` sooner — a larger
`mcp-server.ts` refactor, tracked separately.
