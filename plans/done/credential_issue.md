# Docker Container Credential Issue

## Summary

The app spawns the `claude` CLI inside a Docker sandbox. The container mounts the host's credential files:

```
~/.claude      → /home/node/.claude
~/.claude.json → /home/node/.claude.json
```

## Root Cause

The Claude Code CLI on macOS stores and refreshes OAuth tokens via **macOS Keychain** — it does NOT write updated tokens to `~/.claude/.credentials.json`. The Docker container has no Keychain access, so it reads the stale/missing credentials file and fails with a 401.

## Symptoms

```
Failed to authenticate. API Error: 401
```
or
```
Not logged in · Please run /login
```

## Fix

```
npm run sandbox:login
```

This extracts the current OAuth credentials from macOS Keychain (`security find-generic-password -s 'Claude Code-credentials'`) and writes them to `~/.claude/.credentials.json`, which the Docker container reads via bind mount.

Run this whenever the token expires (typically every few hours).

To remove the credentials file:

```
npm run sandbox:logout
```

## Why `claude auth login` Inside Docker Does Not Work

On macOS Docker Desktop, containers run inside a Linux VM. The `claude auth login` CLI starts a local HTTP server on a random port for the OAuth callback, but:

- **`--network host`** shares the VM's network, not the Mac's — the browser can't reach the container's HTTP server
- **`-p PORT:PORT`** requires knowing the port in advance — the CLI picks a random port
- **Code-based flow** (pasting a code) — the CLI doesn't read from stdin; it waits for the HTTP callback

Running `claude auth login` on the host writes only to Keychain, not to the credentials file.

## Keychain Entry

- **Service**: `Claude Code-credentials`
- **Format**: JSON with `claudeAiOauth.accessToken`, `refreshToken`, `expiresAt`, `scopes`, `subscriptionType`
