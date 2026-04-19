# Non-Root Sandbox User

## Current State

`Dockerfile.sandbox` has no `USER` directive. `node:22-slim` defaults to root, so `claude` runs as UID 0 inside the container.

The root dependency is structural: `server/agent/index.ts` mounts `~/.claude` to `/root/.claude`. If the container user were non-root, that path would not exist and Claude Code would fail to authenticate.

```
-v ~/.claude:/root/.claude     ← only works for UID 0
```

**Workspace path inconsistency**: The workspace is hardcoded to `~/mulmoclaude` (`server/workspace/workspace.ts`), but inside the container it is mounted as `/workspace`. Claude therefore sees a different path depending on whether the sandbox is active or not — the system prompt reflects this (`server/agent/prompt.ts:107`). This creates inconsistency in tool calls, file references, and session continuity across sandboxed and non-sandboxed runs.

---

## Security Review

### Running as Root — Risks

**Container escape amplification**
Docker's isolation is strong but not perfect (kernel exploits, misconfigured mounts, runc CVEs). If Claude escapes the container while running as root, it lands on the host as root — full machine compromise. A non-root escape would be contained to the user's own files.

**Writable mounts owned by root**
`/workspace` is read-write and bind-mounted from the host. Files created by Claude inside the container are owned by root on the host. The user must `sudo chown` to recover ownership of their own workspace files.

**Principle of least privilege violated**
Claude only needs to read/write `/workspace` and read `/app`. It has no legitimate need for root capabilities (raw sockets, `CAP_NET_ADMIN`, `CAP_SYS_ADMIN`, etc.), yet it holds all of them.

**No `--cap-drop` or `--security-opt`**
The current `docker run` invocation does not drop Linux capabilities or enable seccomp/AppArmor profiles. Combined with root, this is a maximally permissive container environment.

### Running as Root — Mitigating Factors

- All app-code mounts (`node_modules`, `server/`, `src/`) are `:ro`, limiting write surface.
- `--rm` ensures no persistent container state.
- Docker's namespacing still isolates the filesystem from the host (absent an escape).
- Claude Code's own `--allowedTools` flag limits what commands Claude can issue.

### Non-Root — Security Gains

- Container escape yields only user-level access on the host (same as the user who started the server).
- Workspace files created inside the container would be owned by the mapped UID, not root.
- Linux capabilities can be dropped to near-zero (`--cap-drop ALL`) without breaking functionality.
- Aligns with CIS Docker Benchmark recommendation 4.1 ("Ensure a non-root user is used").

---

## User Experience Review

### Current UX (Root)

**Con: Workspace path inconsistency**
Inside the sandbox, Claude sees the workspace as `/workspace`. Outside, it is `~/mulmoclaude`. This means file paths in tool calls, memory, and session context differ depending on whether Docker is running — undermining the goal of a consistent workspace experience.

**Con: Workspace file ownership corruption (Linux only)**
On Linux, files Claude creates in `/workspace` appear on the host as owned by root. The user must `sudo chown` to recover ownership. This is a real day-to-day friction point on Linux.

**macOS exception**: Docker Desktop uses virtiofs for bind mounts, which transparently maps the container's root UID to the macOS user who owns the mount. Files written by root inside the container appear owned by the host user in Finder and the terminal. File ownership corruption is **not a practical issue on macOS**.

**Pro: Zero setup**
Works out of the box. No UID mapping required. The `~/.claude` mount just works.

**Pro: No permission errors inside the container**
Root can read/write anything it encounters, so Claude never hits unexpected permission denied errors on app files.

### Non-Root UX (Proposed)

**Pro: Consistent workspace path**
Mount the workspace at `/home/node/mulmoclaude` (i.e. `~/mulmoclaude` for the `node` user):
```ts
`${toDockerPath(workspacePath)}:/home/node/mulmoclaude`,
```
Claude always sees `~/mulmoclaude` regardless of sandbox state. File references, memory, and session context are portable between sandboxed and non-sandboxed runs.

**Pro: Correct file ownership on Linux**
Files Claude creates belong to the host user (with UID mapping). Normal editing workflow is preserved on Linux.

**Pro: Cleaner security posture**
Users who care about security can trust the sandbox is properly locked down.

**Con: File ownership gain is moot on macOS**
Since Docker Desktop + virtiofs already maps root writes to the host user, switching to non-root provides no ownership improvement on macOS — the main UX motivation disappears.

**Con: UID mismatch problem (Linux)**
The `node` user inside `node:22-slim` is UID 1000. If the host user is a different UID, files in `/workspace` will be owned by 1000 on the host. Requires `--user $(id -u):$(id -g)` at runtime to fix.

**Con: `.claude` mount path changes**
Must change `/root/.claude` → `/home/node/.claude` (or wherever the non-root home is), and ensure the mount is readable by that user.

**Con: Possible permission errors on `:ro` mounts**
`/app/node_modules` and `/app/server` are mounted read-only but owned by the host user. A non-root container user can still read them as long as the files have world-readable permissions (`644`/`755`), which is typical for npm packages. Unlikely to be an issue in practice.

---

## Pros and Cons Summary

| Dimension | Root (current) | Non-root |
|---|---|---|
| Container escape impact | Full host root compromise | Host user-level access only |
| Linux capabilities | All (unrestricted) | Can drop to near-zero |
| Workspace file ownership | Owned by root on host (Linux); host user on macOS via virtiofs | Owned by host user with UID mapping (Linux); no change on macOS |
| Workspace path | `/workspace` in container, `~/mulmoclaude` on host — inconsistent | `/home/node/mulmoclaude` = `~/mulmoclaude` in container — consistent |
| `.claude` mount | `/root/.claude` — works trivially | `/home/node/.claude` — requires Dockerfile change |
| UID mismatch on macOS | Not applicable | Partially mitigated by Docker Desktop's virtiofs |
| Setup complexity | None | Requires `--user $(id -u):$(id -g)` at runtime |
| CIS Docker Benchmark | Fails 4.1 | Passes 4.1 |

---

## Recommended Implementation

1. **`Dockerfile.sandbox`** — add `USER node` and set `WORKDIR` to `~/mulmoclaude` for the `node` user. Dockerfiles do not expand `~`, so use the explicit path:
   ```dockerfile
   FROM node:22-slim
   RUN npm install -g @anthropic-ai/claude-code tsx
   USER node
   WORKDIR /home/node/mulmoclaude
   ```

2. **`server/agent/index.ts`** — four changes:
   - Mount the workspace at `/home/node/mulmoclaude` instead of `/workspace`:
     ```ts
     `${toDockerPath(workspacePath)}:/home/node/mulmoclaude`,
     ```
   - Update the MCP config arg path (currently hardcoded to `/workspace/...`):
     ```ts
     mcpConfigArgPath = `/home/node/mulmoclaude/.mulmoclaude/mcp-${sessionId}.json`;
     ```
   - Change the `.claude` mount target and add `--user` flag:
     ```ts
     `${toDockerPath(homedir())}/.claude:/home/node/.claude:ro`,
     "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
     ```
   - Set `HOME` explicitly so `claude` can find its credentials regardless of effective UID:
     ```ts
     "-e", "HOME=/home/node",
     ```
     **Why this is required**: `--user UID:GID` passes the host UID (e.g. 501 on macOS), which has no entry in the container's `/etc/passwd`. Without a passwd entry the shell never sets `HOME`, so `claude` cannot locate `~/.claude` and hangs waiting for auth (with stdin closed, it never completes).

   Note: `process.getuid()` is not available on Windows; guard accordingly.

3. **`server/agent/index.ts`** — add `--cap-drop ALL` to further harden:
   ```ts
   "--cap-drop", "ALL",
   ```

### Container Mount Layout

| Container path | Source | Access |
|---|---|---|
| `/app/node_modules` | `projectRoot/node_modules` | ro |
| `/app/server` | `projectRoot/server` | ro |
| `/app/src` | `projectRoot/src` | ro |
| `/home/node/mulmoclaude` | `workspacePath` | rw |
| `/home/node/.claude` | `~/.claude` | ro |

4. **Automatic image rebuild** — `ensureSandboxImage()` in `server/system/docker.ts` detects stale images automatically. At build time it embeds a SHA-256 hash of `Dockerfile.sandbox` as an image label (`mulmoclaude.dockerfile.sha256`). On every server start it compares the label against the current file hash and rebuilds if they differ, streaming `docker build` output to the server console in real time. Users never need to run `docker rmi` manually.

### macOS Note

Docker Desktop's virtiofs already maps root writes in the container to the host user on macOS — confirmed by inspection of sandbox-created files. The primary UX motivation for this change (file ownership) only applies to Linux users. The security motivation (limiting container escape impact) applies on both platforms.
