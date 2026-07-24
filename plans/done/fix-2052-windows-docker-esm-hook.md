# fix #2052 — the ESM resolver hook never fires in the Windows Docker sandbox

Issue: [#2052](https://github.com/receptron/mulmoclaude/issues/2052)
Related: #1946 → PR #1974 · #1982 → PR #1984 · PR #1995 (the hook that "doesn't take effect")

## User prompt

> https://github.com/receptron/mulmoclaude/issues/2052 これ、つめていける？windowsのciなどを使って直したい。

## What the reporter saw

Windows 23H2 + Docker Desktop (WSL2), source checkout, sandbox ON, at commit `c15980d0`:

1. Chatting → `ERROR [agent-stderr] Error: MCP tool mcp__mulmoclaude__handlePermission (passed via --permission-prompt-tool) not found.`
2. `npx tsx --test test/agent/test_mcp_docker_smoke.ts` → **the exact same error text as before PR #1974**:
   ```text
   node:internal/modules/cjs/loader:1430
   Error: Cannot find module '@mulmoclaude/x-plugin'
   Require stack:
     /app/server/agent/mcp-tools/index.ts
     /app/server/agent/mcp-server.ts
   ```

## Findings (static, before touching CI)

### F1 — the smoke test is stale, and that explains symptom 2

`test/agent/test_mcp_docker_smoke.ts` **hardcodes** its `docker run` argv instead of deriving
it from the shipped builders. It is missing everything the two prior fixes added:

| production (`server/agent/config.ts`)                                                     | the smoke test                |
| ----------------------------------------------------------------------------------------- | ----------------------------- |
| `workspaceModuleMounts()` → `-v <pkg>:/app/pkg_modules/@mulmoclaude/<name>:ro` (PR #1974) | **absent**                    |
| `NODE_PATH=/app/node_modules:/app/pkg_modules` (PR #1974)                                 | `NODE_PATH=/app/node_modules` |
| `tsx --import file:///app/server/agent/mcp-esm-bootstrap.mjs <server>` (PR #1995)         | `tsx <server>`                |

So the test reproduces the **pre-#1974** configuration. Its failure is an artifact of the test,
not evidence that PR #1995 is broken. A test that cannot see the fix cannot verify the fix.

### F2 — `/app` has no `package.json`, so the container runs the server graph as **CJS**

`dockerBindMountArgs()` mounts `/app/node_modules`, `/app/server`, `/app/src`, `/app/packages`,
`/app/pkg_modules/*`, the workspace and the claude config. **It never mounts a `package.json`
into `/app`.** The repo root declares `"type": "module"`, but that file is invisible inside the
container, so `tsx` resolves `/app/server/agent/*.ts` to **CommonJS**.

`module.register()` — what `mcp-esm-bootstrap.mjs` calls — installs a hook on the **ESM**
resolver only. It is never consulted by `require()`. Hence the `Require stack:` in the
reporter's trace: the hook is registered and then never asked anything.

**PR #1995 cannot work as written, on any host, in this container.** Linux/macOS simply never
notice because `/app/node_modules/@mulmoclaude/*` are live POSIX symlinks there, so primary
resolution succeeds and no fallback is needed.

### F3 — the Windows CI probe passes because it tests a layout production does not have

`.github/workflows/docker_sandbox_windows.yaml` runs `tsx --import <bootstrap> /repro/probe.ts`,
and `test/sandbox-repro/package.json` is `{"private": true, "type": "module"}`. That one file
puts the probe in ESM mode, so the hook fires and the probe goes green — while the real MCP
child, which has no such file, runs CJS. The probe validates a configuration that does not ship.

### F4 — WITHDRAWN. `@mulmoclaude/core`'s `workspace-setup` is ESM-only on purpose

I flagged the missing `require` condition on `./workspace-setup` as a rule violation. It is not:
`vite.esm.config.ts` builds that entry ESM-only because it uses `import.meta.url` for asset
resolution, which cannot be emitted as CJS. There is no `.cjs` to point a `require` condition at,
and Node's `require(esm)` (>= 22.12) loads it fine — as the end-to-end run confirms. Adding the
condition would have broken it.

### F5 — THE ACTUAL BUG: the fallback only ever covered `@mulmoclaude/*`

Measured, not guessed. Running the real `mcp-server.ts` under the production spec with dangling
junctions:

```text
Error: Cannot find module '@mulmobridge/protocol'
Require stack:
- /app/src/types/events.ts
- /app/server/agent/mcp-tools/spawnBackgroundChat.ts
- /app/server/agent/mcp-tools/index.ts
- /app/server/agent/mcp-server.ts
```

yarn junctions **every** workspace package — `packages/*`, `packages/bridges/*`,
`packages/plugins/*`, `packages/services/*`. But:

- `workspacePackageDirs()` scanned only `packages/core` + `packages/plugins/*`
- `scopedPackageName()` accepted only names starting with `@mulmoclaude/`
- `mcp-esm-loader.mjs` hardcoded `const SCOPE = "@mulmoclaude/"`

So `@mulmobridge/protocol` (reached through `src/types/events.ts`) and `@mulmobridge/client` had
no `/app/pkg_modules` fallback. On Windows their junctions dangle, the MCP child dies at load, and
every tool — `handlePermission` included — disappears from the agent registry. **That is symptom 1.**

Proof, same container, only the scope filter changed:

| `scopedPackageName` accepts   | result                                                    |
| ----------------------------- | --------------------------------------------------------- |
| `@mulmoclaude/` only (before) | `Cannot find module '@mulmobridge/protocol'`, exit 1      |
| any `@scope/` (after)         | `serverInfo` + `handlePermission` in `tools/list`, exit 0 |

## Superseded: the one thing that was unmeasured

In the **real** layout (CJS + `NODE_PATH=/app/node_modules:/app/pkg_modules`), does
`require("@mulmoclaude/x-plugin")` fall through `Module.globalPaths` to `/app/pkg_modules`,
or does `tsx`'s CJS require hook bypass `NODE_PATH`?

Every `@mulmoclaude/*` specifier the MCP child imports **does** carry a `require` condition whose
target exists (checked statically), so if `globalPaths` is consulted, CJS should already work.
That contradicts symptom 1 — which means something else is failing, and we must **measure, not
guess**. That is what the Windows CI job is for.

## Plan

### P1 — make the smoke test faithful (so it can never drift again)

Rewrite `test/agent/test_mcp_docker_smoke.ts` to derive its `docker run` argv from the shipped
`buildDockerSpawnArgs()` / `buildMulmoclaudeServer()` rather than hardcoding it. Add a POSIX unit
test asserting the derived argv contains the `/app/pkg_modules` mounts, the two-entry `NODE_PATH`,
and the `--import <bootstrap>` flag. This turns symptom 2 into a faithful reproduction and stops
the class of bug where a fix ships but the test never sees it.

### P2 — reproduce the production layout on Windows CI and take a reading

Extend `.github/workflows/docker_sandbox_windows.yaml` with a **diagnostic job** that mounts
exactly what production mounts (crucially: **no** `package.json` under `/app`) and runs a probe
that reports, rather than asserts:

- the module format Node picks for `/app/server/agent/mcp-server.ts` (CJS or ESM)
- whether the registered ESM `resolve()` hook is ever invoked
- `process.env.NODE_PATH` and `module.globalPaths`
- for every `@mulmoclaude/*` specifier `mcp-tools/index.ts` imports: `require.resolve()`,
  `require.resolve.paths()`, and `await import()` — each with its error, if any
- `lstat` of `/app/node_modules/@mulmoclaude/x-plugin` (proving the junction dangles)

Trigger it with `workflow_dispatch` on the fix branch. Read the evidence.

### P3 — fix, guided by P2

Leading candidate: give the container a `package.json` declaring `"type": "module"` for the
mounted server tree, so the graph is ESM and PR #1995's hook actually applies. Alternative /
complement: `module.registerHooks()` (Node 22) installs **synchronous** hooks that also cover
`require()`, which would make the fix format-agnostic. Choose after reading P2, not before.

### P4 — fix F5 (the real bug)

- `workspacePackageDirs()` walks `packages/*` and descends one level into grouping dirs
  (`plugins/`, `bridges/`, `services/`), matching the workspace globs structurally.
- `scopedPackageName()` accepts any `@scope/` name; only the unscoped `mulmoclaude` launcher is skipped.
- `mcp-esm-loader.mjs` drops its hardcoded scope for the same reason.

### P5 — permanent regression coverage

- The Windows probe must run the **production** layout. Keep an explicit assertion that
  `/app/package.json` is absent-or-present exactly as production has it, so F3 cannot recur.
- Add a section to `packages/core/assets/helps/error-recovery.md` describing this failure mode
  (`Cannot find module '@mulmoclaude/*'` + `Require stack:` inside the sandbox) and its check.

## Verification

- `yarn lint` / `yarn typecheck` / `yarn build` / `yarn test` green.
- The rewritten smoke test passes on Linux (CI) and, per the reporter, on Windows.
- The Windows CI job runs the production layout and passes.
- Manual: the reporter re-runs the chat flow and `handlePermission` resolves.

## Non-goals

- Rewriting the sandbox mount scheme.
- Making the Windows job part of every PR (it stays schedule + `workflow_dispatch`; see
  `docs/windows-docker-ci.md`).
