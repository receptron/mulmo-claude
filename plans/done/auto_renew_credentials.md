# Auto-Renew Expired OAuth Credentials via PTY

## Problem

The existing `refreshCredentials()` in `server/system/credentials.ts` copies the OAuth token from macOS Keychain to `~/.claude/.credentials.json` for the Docker sandbox. However, when the **access token stored in the Keychain itself is expired**, copying it to the file just copies an expired token — the 401 error persists.

The host Claude CLI normally refreshes expired tokens automatically when it runs, but our code never triggers that refresh.

## Solution

Before copying credentials from Keychain, check whether the access token is expired. If it is, spawn `claude` in interactive mode via a PTY to force the CLI to refresh its own token. Once the CLI responds, the Keychain contains a fresh token, and we can proceed with the existing copy-to-file logic.

### Why a PTY?

The Claude CLI requires a TTY to run interactively. A plain `child_process.spawn` won't work because the CLI detects it's not attached to a terminal and behaves differently. `node-pty` provides a pseudo-terminal that satisfies this requirement.

## Implementation

### 1. Add `node-pty` dependency

```bash
yarn add node-pty
```

`node-pty` is a native module — it compiles on install. It works on macOS, Linux, and Windows. Since this credential renewal is macOS-only (`process.platform === "darwin"`), the PTY spawn only runs on macOS.

### 2. Update `server/system/credentials.ts`

#### New helper: `isTokenExpired(credentialsJson: string): boolean`

Parse the Keychain JSON, extract `claudeAiOauth.expiresAt` (epoch ms), and return `true` if the current time is past that timestamp (with a small margin, e.g. 60 seconds).

#### New helper: `renewTokenViaPty(): Promise<boolean>`

Spawn `claude` interactively via `node-pty`:

```typescript
import pty from "node-pty";

function renewTokenViaPty(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = pty.spawn("claude", [], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
    });

    let responded = false;
    let buffer = "";
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 30_000); // 30s safety timeout

    proc.onData((data: string) => {
      buffer += data;

      if (!responded && buffer.includes("hi")) {
        responded = true;
        return;
      }

      if (responded) {
        clearTimeout(timeout);
        proc.kill();
        resolve(true);
      }
    });

    // Wait for initial prompt before sending input
    setTimeout(() => {
      proc.write("hi\r");
    }, 3000);
  });
}
```

#### Updated `refreshCredentials()` flow

```text
1. Read credentials JSON from Keychain (existing logic)
2. If empty → return false
3. Parse and check expiresAt → if NOT expired, write to file and return true (fast path)
4. If expired:
   a. Log that token is expired, attempting renewal
   b. Call renewTokenViaPty()
   c. If renewal succeeded, re-read from Keychain (now has fresh token)
   d. Write the fresh credentials to file
   e. Return true/false based on success
```

### 3. No changes needed in `server/agent/index.ts`

The call site (`agent.ts:127-128`) already calls `refreshCredentials()` before each agent run. The new expiry check and PTY renewal are internal to `refreshCredentials()`.

### 4. Server console logging

Every step of the renewal flow must be visible in the server console via the structured logger (`log.*` from `server/system/logger/`). Use prefix `"credentials"`.

| Situation | Level | Example message |
|---|---|---|
| Token is valid (fast path) | `info` | `"Access token is valid, expires at 2026-04-13T18:00:00Z"` |
| Token is expired, starting PTY renewal | `warn` | `"Access token expired at 2026-04-13T12:00:00Z, launching claude CLI to renew..."` |
| PTY renewal succeeded | `info` | `"Token renewed successfully via claude CLI"` |
| PTY renewal timed out | `error` | `"Token renewal timed out after 30s"` |
| PTY renewal failed (other) | `error` | `"Token renewal via claude CLI failed"` |
| Re-read from Keychain after renewal | `info` | `"Fresh credentials written to ~/.claude/.credentials.json"` |
| Credentials JSON parse error | `error` | `"Failed to parse credentials JSON from Keychain"` |

This ensures the operator can see exactly what happened when a 401 occurs — whether the token was expired, whether renewal was attempted, and whether it succeeded.

## Considerations

- **Timeout**: The PTY spawn has a 30-second timeout. If `claude` hangs or fails to respond, we kill it and return false (falling back to the existing stale-token behavior).
- **Concurrency**: `refreshCredentials()` is called once per agent run. No concurrent PTY spawns expected, but could add a mutex if needed later.
- **Non-macOS**: The entire flow is guarded by `process.platform === "darwin"`. No impact on other platforms.
- **First-time login**: If there are no credentials at all in the Keychain, the existing early-return (`if (!credentials) return false`) still applies — the PTY renewal only activates when credentials exist but the access token is expired.
