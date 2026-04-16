# Sandbox

MulmoClaude runs the Claude Code agent inside a **Docker sandbox** when Docker is available. This isolates the agent's file-system access and limits what it can do on the host.

## How It Works

- On each agent invocation, the server checks whether Docker is running.
- If Docker is available (and `DISABLE_SANDBOX` is not set), Claude Code runs inside a disposable container (`mulmoclaude-sandbox`) built from `Dockerfile.sandbox`.
- If Docker is not available, Claude Code runs directly on the host with the workspace as its working directory.

## What the Container Can Access

| Mount | Container path | Mode |
|---|---|---|
| Workspace | `/home/node/mulmoclaude` | read-write |
| `node_modules/` | `/app/node_modules` | read-only |
| `server/` | `/app/server` | read-only |
| `src/` | `/app/src` | read-only |
| `~/.claude/` | `/home/node/.claude` | read-write |
| `~/.claude.json` | `/home/node/.claude.json` | read-write |

The container runs with `--cap-drop ALL` and as the host user's UID/GID, so it has no elevated privileges.

## Disabling the Sandbox

Set the environment variable `DISABLE_SANDBOX=1` to always run the agent directly on the host, even when Docker is available.

## Host Credentials (opt-in)

The sandbox is credential-free by default. Two opt-in flags let you expose the minimum needed for `git` / `gh` to authenticate without leaking private keys into the container:

- `SANDBOX_SSH_AGENT_FORWARD=1` — forwards the host's SSH agent socket (private keys stay on the host).
- `SANDBOX_MOUNT_CONFIGS=gh,gitconfig` — allowlisted read-only config mounts.

Full contract, what's deliberately excluded, and troubleshooting: [`docs/sandbox-credentials.md`](../../docs/sandbox-credentials.md).

## First-Time Setup (macOS)

On macOS, the Docker container uses a separate credential store from the host. Before using the sandbox for the first time (and whenever the credential expires), run:

```
yarn sandbox:login
```

This opens an interactive `claude login` session inside the container so that the sandbox has valid credentials.

## Building the Image

The sandbox image is built automatically on first use. If `Dockerfile.sandbox` changes, the image is rebuilt on the next agent invocation. No manual build step is needed.
