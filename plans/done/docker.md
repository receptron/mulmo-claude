# Docker Sandbox Plan

## Goal

Run the `claude` CLI subprocess inside a Docker container so that Bash tool access is restricted to the workspace directory only. If Docker is not installed, the app falls back to running `claude` directly (unrestricted). No user configuration is required beyond installing Docker Desktop.

## What the Sandbox Protects

The Docker container mounts only the workspace directory. Even if Claude runs `cat ~/.ssh/id_rsa` or `rm -rf ~` via Bash, those paths simply don't exist inside the container.

Network access (WebFetch, WebSearch) remains unrestricted — isolation is filesystem-only.

## New Files

### `Dockerfile.sandbox`

Minimal image containing only the `claude` CLI:

```dockerfile
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /workspace
```

No home directory secrets, no system credentials, no host filesystem.

### `server/system/docker.ts`

Handles detection and image lifecycle:

```typescript
export async function isDockerAvailable(): Promise<boolean>
export async function ensureSandboxImage(projectRoot: string): Promise<void>
```

- `isDockerAvailable` runs `docker info` with a short timeout; caches the boolean result for the lifetime of the server process. Returns `false` immediately if `DISABLE_SANDBOX=1` is set.
- `ensureSandboxImage` runs `docker image inspect mulmoclaude-sandbox`; if the image is missing, builds it from `Dockerfile.sandbox`. Called once at server startup when Docker is available.

## Modified Files

### `server/index.ts`

At startup, detect Docker and pre-build the image:

```typescript
import { isDockerAvailable, ensureSandboxImage } from "./docker.js";

const dockerEnabled = await isDockerAvailable();
if (process.env.DISABLE_SANDBOX === "1") {
  console.log("[sandbox] DISABLE_SANDBOX=1 — running unrestricted (debug mode)");
} else if (dockerEnabled) {
  console.log("[sandbox] Docker available — building sandbox image if needed");
  await ensureSandboxImage(projectRoot);
  console.log("[sandbox] Sandbox ready");
} else {
  console.log("[sandbox] Docker not found — claude will run unrestricted");
}
```

Export `dockerEnabled` so `agent.ts` can read it without re-checking.

### `GET /api/health` — expose sandbox status

Add `sandboxEnabled: boolean` to the health response so the frontend can read it:

```typescript
res.json({ status: "OK", sandboxEnabled: dockerEnabled });
```

### Frontend warning banner

The frontend polls or reads `/api/health` on startup. When `sandboxEnabled` is false, display a dismissible warning banner in the UI:

```
⚠️ Docker is not installed. Claude can access all files on your machine.
   See the Security section in README for details.  [Dismiss]
```

The banner should be prominent (top of screen) but non-blocking — the user can still use the app. Dismissal is per-session only (not persisted), so it reappears on next launch as a reminder.

### `server/agent/config.ts`

#### MCP config path

Currently the MCP config is written to `tmpdir()`. When running in Docker, only the workspace is mounted, so the MCP config must live inside the workspace:

```
host path:      {workspacePath}/.mulmoclaude/mcp-{sessionId}.json
container path: /workspace/.mulmoclaude/mcp-{sessionId}.json
```

Add a `useDocker` parameter to `buildMcpConfig` so it can set the correct `MCP_HOST` in the MCP server's env:

```typescript
export interface McpConfigParams {
  sessionId: string;
  port: number;
  activePlugins: string[];
  roleIds: string[];
  useDocker: boolean;   // ← new
}
```

When `useDocker` is true, add `MCP_HOST: "host.docker.internal"` to the MCP server env block so the MCP server calls back to the host Express server rather than `localhost` inside the container.

#### CLI args path

`buildCliArgs` receives `mcpConfigPath`. When using Docker this must be the **container-side** path (`/workspace/.mulmoclaude/mcp-{sessionId}.json`), not the host path. Pass both:

```typescript
export interface CliArgsParams {
  ...
  mcpConfigPath?: string;         // path used in the args (container path if docker)
}
```

The host path is only needed for cleanup (`unlink` after the session).

### `server/agent/mcp-server.ts`

Replace the hardcoded `localhost` with an env var:

```typescript
// Before
const BASE_URL = `http://localhost:${PORT}`;

// After
const MCP_HOST = process.env.MCP_HOST ?? "localhost";
const BASE_URL = `http://${MCP_HOST}:${PORT}`;
```

When the MCP server runs inside Docker, `MCP_HOST` is `host.docker.internal`, allowing it to reach the Express server on the host machine.

### `server/agent/index.ts`

Conditional spawn based on `dockerEnabled`:

```typescript
// Non-docker (current behavior)
const proc = spawn("claude", args, {
  cwd: workspacePath,
  stdio: ["ignore", "pipe", "pipe"],
});

// Docker
const proc = spawn("docker", [
  "run", "--rm",
  "-v", `${workspacePath}:/workspace`,
  "-v", `${homedir()}/.claude:/root/.claude`,  // Claude auth + settings
  "--add-host", "host.docker.internal:host-gateway",  // Linux compat
  "mulmoclaude-sandbox",
  "claude", ...args,
], {
  stdio: ["ignore", "pipe", "pipe"],
});
```

MCP config file path handling:

```typescript
const mcpConfigDir = dockerEnabled
  ? join(workspacePath, ".mulmoclaude")
  : tmpdir();

const mcpConfigHostPath = join(mcpConfigDir, `mcp-${sessionId}.json`);
const mcpConfigContainerPath = `/workspace/.mulmoclaude/mcp-${sessionId}.json`;
const mcpConfigArgPath = dockerEnabled ? mcpConfigContainerPath : mcpConfigHostPath;
```

After the session, `unlink(mcpConfigHostPath)` regardless of mode.

## Platform Differences

### `host.docker.internal`

| Platform | Behavior |
|----------|----------|
| macOS | Resolves automatically — no extra flags needed |
| Windows | Resolves automatically — no extra flags needed |
| Linux | Does not resolve — requires `--add-host host.docker.internal:host-gateway` |

Detect at runtime and conditionally add the flag:

```typescript
const extraHosts = process.platform === "linux"
  ? ["--add-host", "host.docker.internal:host-gateway"]
  : [];

spawn("docker", [
  "run", "--rm",
  ...extraHosts,
  ...
]);
```

### Windows path normalization

Windows workspace paths use backslashes (e.g. `C:\Users\satoshi\workspace`). Docker requires forward slashes in volume mount arguments. Normalize before passing to `docker run`:

```typescript
function toDockerPath(p: string): string {
  return p.replace(/\\/g, "/");
}

"-v", `${toDockerPath(workspacePath)}:/workspace`,
"-v", `${toDockerPath(homedir())}/.claude:/root/.claude`,
```

## Sequence Diagram

```
Browser → POST /api/agent → Express server
                                │
                    dockerEnabled?
                   /             \
                 yes              no
                  │               │
          docker run            spawn("claude", args)
          mulmoclaude-sandbox     │
            │                     │
          spawn("claude", args)   │
            │                     │
          MCP server (in container)
            │  http://host.docker.internal:3001/api/internal/tool-result
            └──────────────────────────────────────────────────────────▶ Express server
                                                                              │
                                                                        SSE stream → Browser
```

## File Summary

| Change | File |
|--------|------|
| New | `Dockerfile.sandbox` |
| New | `server/system/docker.ts` |
| Modified | `server/index.ts` — startup detection + image build |
| Modified | `server/agent/index.ts` — conditional spawn |
| Modified | `server/agent/config.ts` — docker-aware MCP config + path handling |
| Modified | `server/agent/mcp-server.ts` — `MCP_HOST` env var |

## README.md Update

Add a **Security** section to `README.md` after the installation/setup section. Tone: informative, not alarmist. Cover:

1. **What Claude can do** — Claude has access to built-in tools including Bash, which can read and write files on your machine.

2. **The risk without Docker** — Without sandboxing, Claude's Bash tool can access any file your user account can read: SSH keys, credentials, config files outside the workspace. This is acceptable for trusted local use but worth understanding.

3. **Docker sandbox** — When Docker Desktop is installed, MulmoClaude automatically runs Claude inside a container. Only the workspace directory and `~/.claude` are visible. Everything else on your filesystem is inaccessible.

4. **Call to action** — Encourage installing Docker Desktop with a link, and note that the app detects it automatically — no configuration needed.

Example structure:

```markdown
## Security

MulmoClaude uses Claude Code as its AI backend, which has access to tools
including Bash — meaning it can read and write files on your machine.

**Without Docker**, Claude can access any file your user account can reach,
including SSH keys and credentials outside your workspace. This is fine for
personal local use, but be aware of the risk.

**With Docker Desktop installed**, MulmoClaude automatically runs Claude
inside a sandboxed container. Only your workspace and Claude's own config
(`~/.claude`) are mounted — the rest of your filesystem is invisible to Claude.
No configuration is required. The app detects Docker on startup and enables
the sandbox automatically.

### Installing Docker Desktop

1. Download Docker Desktop from https://www.docker.com/products/docker-desktop/
2. macOS: open the `.dmg` and drag Docker to Applications, then launch it
3. Windows: run the installer and follow the prompts (requires WSL2, which the installer sets up automatically)
4. Linux: follow the [Linux install guide](https://docs.docker.com/desktop/install/linux/)
5. Wait for Docker Desktop to finish starting (whale icon in the menu bar/system tray turns steady)
6. Restart MulmoClaude — it will detect Docker and build the sandbox image on first run (one-time, takes ~1 minute)
```

## Out of Scope

- Network restriction (WebFetch/WebSearch remain unrestricted by design)
- Multi-user or cloud deployment auth (separate concern)
