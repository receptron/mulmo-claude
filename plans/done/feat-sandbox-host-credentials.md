# Sandbox host credentials — SSH agent forward + config mounts (#259)

## Goal

Let Claude do authenticated `git` / `gh` operations inside the Docker sandbox **without** spraying host credentials into the container. Opt-in only. Extensible beyond `gh`.

## Design

Two **independent** env-var toggles, composable:

1. `SANDBOX_SSH_AGENT_FORWARD=1` — forwards the host's SSH agent socket.
2. `SANDBOX_MOUNT_CONFIGS=gh,gitconfig` — CSV list of allowlisted config mounts.

### Why two separate mechanisms

- SSH agent forward is a **socket**, not a filesystem bind. Private keys never enter the container; the agent on the host signs. Different kernel object, different safety story.
- Config mounts are **read-only filesystem binds**. Simpler, narrower. They expose plaintext files.

Same env var would have conflated these; users would turn on "auth" and silently get a thing they didn't ask for.

### Config-mount allowlist (server-side, not user-editable)

Defined once in `server/agent/sandboxMounts.ts`:

```ts
const ALLOWED: Record<string, SandboxMountSpec> = {
  gh: {
    hostPath: ~/.config/gh,
    containerPath: /home/node/.config/gh,
    kind: "dir",
    description: "GitHub CLI auth + hosts config",
  },
  gitconfig: {
    hostPath: ~/.gitconfig,
    containerPath: /home/node/.gitconfig,
    kind: "file",
    description: "Git user identity (name, email, signing key)",
  },
};
```

Users can't pass arbitrary paths — they pass names; the server resolves. Unknown names produce a hard error at startup. Missing host paths are skipped with a one-shot warning so a user without `.gitconfig` just gets a no-op instead of a crash.

Adding a new tool (e.g. `npm`, `aws`) later = one row in this file + one row in the docs table. No new env var parsing, no user-visible schema change.

### Docker args additions

Extending `buildDockerSpawnArgs` in `server/agent/config.ts`. Each resolved mount adds `-v <hostPath>:<containerPath>:ro`. SSH agent forward adds `-v $SSH_AUTH_SOCK:/ssh-agent` + `-e SSH_AUTH_SOCK=/ssh-agent`.

### What's **not** in this change (deliberately)

- `~/.ssh` direct mount — we want agent forward, not private key exposure.
- `~/.git-credentials` — plaintext HTTPS creds for any host; too wide. Users who need this can turn it into their own allowlist entry locally.
- macOS Keychain — not fs-mountable, would need a separate bridge.
- Cloud CLIs (`gcloud`, `aws`, Azure) — bigger blast radius, separate discussion.
- Symlink resolution inside mounts — Docker follows symlinks on the host side, then binds the target. If a user has `~/.config/gh` symlinked to a secret elsewhere, the container sees the target. Documented but not mitigated.

### What the sandbox **can't** do even with these on

- `git push` to non-GitHub HTTPS remotes if the creds are in `osxkeychain` / `wincred` helpers — no filesystem path to forward.
- Prompt for a passphrase on an ssh-agent key — container has no tty for the passphrase prompt. If the key is passphrase-protected, add it to the host agent first.
- Remote hosts that require TTY-based 2FA (`gh auth login` interactive) — run those on the host, then the sandbox inherits via the mount.

## Files

- **new** `server/agent/sandboxMounts.ts` — allowlist + resolver + parse/validate.
- **edit** `server/system/env.ts` — `sandboxSshAgentForward`, `sandboxMountConfigs` (CSV).
- **edit** `server/agent/config.ts` — `buildDockerSpawnArgs` consumes resolved mounts + agent forward flag.
- **new** `docs/sandbox-credentials.md` — user-facing guide. Table of allowed names, what/where, opt-in recipe, what we don't do, what we can't do, troubleshooting.
- **edit** `server/workspace/helps/sandbox.md` — pointer to new doc + one-liner about the flags.
- **edit** `docs/developer.md` — env var table row.
- **new** `test/agent/test_sandboxMounts.ts` — unit tests for parse + resolver.

## Verification

- Unit tests cover: empty CSV → empty list; unknown name → error; known name → correct spec; missing host path → logged warning + skipped.
- Manual: set `SANDBOX_MOUNT_CONFIGS=gh,gitconfig SANDBOX_SSH_AGENT_FORWARD=1` on a machine with the three artefacts present, run `yarn dev`, confirm `docker ps` shows the extra mounts and `SSH_AUTH_SOCK` env.
- Inside the container, `gh auth status` and `git config --global user.email` should both report values.
