# fix(#1946): Windows Docker sandbox MCP server — dangling yarn-workspace junctions

Issue: #1946 (Windows + Docker sandbox ON, `mcp-server.ts` crashes → `handlePermission not found`)

## Root cause (confirmed in-container)

On Windows, yarn workspaces write `node_modules/@mulmoclaude/*` as **absolute** junctions
(`fs.symlink(..., "junction")` normalises the target to an absolute host path). Docker Desktop
surfaces them as `/mnt/host/c/Users/<user>/.../packages/<name>`, a path that does not exist in the
Linux container → the symlinks **dangle**. The MCP child (`tsx /app/server/agent/mcp-server.ts`)
imports `@mulmoclaude/x-plugin` + `@mulmoclaude/core/*` at load, hits `MODULE_NOT_FOUND`, and dies
before the initialize handshake → zero `mulmoclaude__*` tools registered → `handlePermission not found`.
`DISABLE_SANDBOX=1` works because the child runs on the host where the junctions resolve.

macOS/Linux are unaffected: there the links are **relative** (`../../packages/core`), which resolve
to `/app/packages/core` — both `node_modules` and `packages/` are bind-mounted.

Affected: all 14 `@mulmoclaude/*` packages (`core` + 13 `packages/plugins/*`).

## Fix — approach A′ (NODE_PATH fallback root)

Docker already runs the MCP child with `NODE_PATH=/app/node_modules` and tsx emits CJS in-container,
so NODE_PATH is honoured. Extend that mechanism instead of touching the dangling junctions.

1. **`buildDockerSpawnArgs`** — when `platform === "win32"` AND `packages/` exists (source/dev build),
   add one bind mount per workspace package at a junction-free scoped root:
   `-v <pkgDir>:/app/pkg_modules/@mulmoclaude/<name>:ro`.
   The scoped `<name>` is read from each package's `package.json` (robust vs. dir-name assumptions;
   also filters to `@mulmoclaude/*` only).
2. **`buildMulmoclaudeServer`** — set the Docker `NODE_PATH` to `/app/node_modules:/app/pkg_modules`.

Windows: primary `/app/node_modules/@mulmoclaude/core` dangles → CJS resolution treats it as absent and
falls through to `/app/pkg_modules/@mulmoclaude/core` (real). Subpath exports (`@mulmoclaude/core/collection/server`)
resolve via the located package's `exports` map. Cross-package `@mulmoclaude/*` imports resolve the same way.

Non-Windows / npx: `/app/pkg_modules` is never mounted, so the extra NODE_PATH entry is a no-op; behaviour
is byte-identical. npx installs have real `node_modules/@mulmoclaude/*` and no `packages/` dir → gated out.

### Why not the alternatives
- **A (overlay real dirs onto `/app/node_modules/@mulmoclaude/<name>`)** — bind-mounting over a dangling
  symlink target is Docker-version-dependent (may fail / land elsewhere); issue flags it "要検証".
- **Entrypoint re-link** — needs a writable node_modules overlay (weakens the read-only security posture)
  and a Dockerfile change.

## Tests
- `test/agent/test_agent_config.ts` — unit-test the argv: on `win32` (temp `packageRoot` with fake
  `packages/core` + a plugin) the `/app/pkg_modules/@mulmoclaude/*` mounts appear; on `darwin`/`linux`
  they do not. Assert `NODE_PATH` includes `/app/pkg_modules` in the docker server config.
- `test/agent/test_mcp_docker_smoke.ts` (docker-gated, Linux CI) — add a case that shadows
  `/app/node_modules/@mulmoclaude` with an empty tmpfs (simulating the Windows dangle) + adds the
  `pkg_modules` mounts + extended NODE_PATH, and asserts `initialize` + non-empty `tools/list` still
  succeed. This proves the fallback actually resolves without needing a Windows host.

## Verification constraint
Windows-only bug; final confirmation needs @ystknsh's Windows machine. Local coverage: argv unit tests
+ (if docker present) the Linux fallback-simulation smoke test.
