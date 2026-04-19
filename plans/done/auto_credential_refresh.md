# Auto-Refresh Credentials on 401 (macOS Sandbox)

## Problem

When running MulmoClaude in sandbox mode on macOS, the Claude CLI inside the Docker container authenticates using `~/.claude/.credentials.json`. However, the host Claude CLI stores and refreshes OAuth tokens in **macOS Keychain**, not in this file. The credentials file goes stale after a few hours, causing `401 authentication_error` failures.

Currently, the user must manually run `npm run sandbox:login` to export fresh tokens from Keychain every time this happens — a poor experience.

## Solution

Detect the 401 authentication error in the agent's stderr output, automatically re-export credentials from macOS Keychain (the same `security find-generic-password` command that `npm run sandbox:login` uses), and retry the agent call — all transparently.

### Conditions

This logic activates **only when all three are true**:

1. The platform is `darwin` (macOS)
2. The app is running in sandbox mode (Docker enabled)
3. The claude CLI exits with a stderr message containing `401` or `authentication_error`

### Implementation

- **`server/system/credentials.ts`** — new module with a `refreshCredentials()` function that extracts the OAuth token from macOS Keychain and writes it to `~/.claude/.credentials.json`. Returns `true` on success, `false` on failure.
- **`server/agent/index.ts`** — after detecting a 401 error on first attempt, call `refreshCredentials()`, and if successful, retry `runAgent` once. If the retry also fails, yield the error as before.
