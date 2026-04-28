import { execFile } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";
import { log } from "./logger/index.js";
import { ONE_SECOND_MS, ONE_MINUTE_MS } from "../utils/time.js";
import { writeFileAtomic } from "../utils/files/atomic.js";

const execFileAsync = promisify(execFile);

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Safety margin — treat tokens as expired 60s before actual expiry. */
const EXPIRY_MARGIN_MS = ONE_MINUTE_MS;
/** Maximum time to wait for the claude CLI to respond. */
const PTY_TIMEOUT_MS = 30 * ONE_SECOND_MS;
/** Delay before sending input to the claude CLI. */
const PTY_INPUT_DELAY_MS = 3 * ONE_SECOND_MS;

interface CredentialsJson {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
  };
}

/**
 * Read the raw credentials string from macOS Keychain.
 */
async function readFromKeychain(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
    const credentials = stdout.trim();
    return credentials || null;
  } catch {
    return null;
  }
}

/**
 * Check whether the access token in the credentials JSON is expired.
 */
function isTokenExpired(raw: string): boolean {
  try {
    const creds: CredentialsJson = JSON.parse(raw);
    const expiresAt = creds.claudeAiOauth?.expiresAt;
    if (!expiresAt) return true; // no expiry info — treat as expired

    const expiresMs = new Date(expiresAt).getTime();
    if (isNaN(expiresMs)) return true;

    return Date.now() >= expiresMs - EXPIRY_MARGIN_MS;
  } catch {
    log.error("credentials", "Failed to parse credentials JSON from Keychain");
    return true;
  }
}

/**
 * Spawn `claude` interactively via a PTY to force the CLI to refresh its
 * OAuth token. The CLI handles the refresh internally and writes the new
 * token back to the macOS Keychain.
 */
async function renewTokenViaPty(): Promise<boolean> {
  // Dynamic import — node-pty is a native module that may not be present
  // on all platforms. Guard with try/catch.
  let pty: typeof import("node-pty");
  try {
    pty = await import("node-pty");
  } catch {
    log.error("credentials", "node-pty not available, cannot renew token");
    return false;
  }

  return new Promise((resolve) => {
    const proc = pty.spawn("claude", [], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
    });

    let responded = false;
    let buffer = "";
    let settled = false;
    // Mutual reference: `finish`'s body needs `timeout` (clearTimeout)
    // and `timeout`'s callback needs `finish`. Predeclared with `let`
    // and assigned exactly once below. `prefer-const` would prefer a
    // direct `const timeout = setTimeout(...)` form, but that needs
    // `finish` already in scope inside the callback, which then
    // forces `clearTimeout(timeout)` inside `finish`'s body to
    // reference an undefined-at-textual-position const — i.e. the
    // chicken-and-egg pair has no const-only spelling. The actual
    // value is single-write at runtime; lint heuristic disagrees.
    // eslint-disable-next-line prefer-const -- mutual-reference pair, see comment above
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      proc.kill();
      resolve(success);
    };

    timeout = setTimeout(() => {
      log.error("credentials", `Token renewal timed out after ${PTY_TIMEOUT_MS / ONE_SECOND_MS}s`);
      finish(false);
    }, PTY_TIMEOUT_MS);

    // Match "hi" as a whole token so unrelated output containing those
    // bytes (e.g. ANSI sequences, words like "This" or "high") can't
    // false-positive the echo detection.
    const ECHO_RE = /\bhi\b/;

    // After the echo, only treat output as a successful renewal when
    // it looks like a real Claude response — a conversational opener
    // (Hello / Hi / I'm / …) AND a non-trivial amount of text. Error
    // chunks ("Please log in", "Invalid credentials", network blips)
    // don't match both conditions, so they fall through to the
    // 30-second timeout and we treat the renewal as failed. A final
    // safety net: `refreshCredentials()` re-reads the Keychain and
    // calls `isTokenExpired()` before writing, so even a false
    // positive here can't persist a stale token.
    const RESPONSE_PATTERN_RE = /\b(Hello|Hi|I['’]m|I can|How can)\b/i;
    const MIN_RESPONSE_CHARS = 20;
    let echoEndIdx = -1;

    proc.onData((data: string) => {
      buffer += data;

      if (!responded) {
        const match = ECHO_RE.exec(buffer);
        if (match) {
          // Claude echoed our "hi" — remember where the response
          // window starts so the success check looks only at bytes
          // that arrived AFTER the echo.
          responded = true;
          echoEndIdx = match.index + match[0].length;
        }
        return;
      }

      const response = buffer.slice(echoEndIdx);
      if (response.length >= MIN_RESPONSE_CHARS && RESPONSE_PATTERN_RE.test(response)) {
        finish(true);
      }
    });

    // Wait for initial prompt before sending input
    setTimeout(() => {
      if (!settled) {
        proc.write("hi\r");
      }
    }, PTY_INPUT_DELAY_MS);
  });
}

/**
 * Extract the current OAuth credentials from the macOS Keychain and write them
 * to ~/.claude/.credentials.json so that the Docker-based sandbox can read them.
 *
 * If the access token is expired, spawns `claude` interactively via a PTY to
 * force the CLI to refresh its token, then re-reads the fresh credentials.
 *
 * Returns true if credentials were successfully refreshed, false otherwise.
 * Only works on macOS (darwin).
 */
export async function refreshCredentials(): Promise<boolean> {
  if (process.platform !== "darwin") return false;

  try {
    let credentials = await readFromKeychain();
    if (!credentials) {
      log.error("credentials", "No credentials found in macOS Keychain");
      return false;
    }

    if (isTokenExpired(credentials)) {
      // Extract expiry for logging
      try {
        const creds: CredentialsJson = JSON.parse(credentials);
        const expiresAt = creds.claudeAiOauth?.expiresAt ?? "unknown";
        log.warn("credentials", `Access token expired at ${expiresAt}, launching claude CLI to renew...`);
      } catch {
        log.warn("credentials", "Access token expired (could not parse expiry), launching claude CLI to renew...");
      }

      const renewed = await renewTokenViaPty();
      if (!renewed) {
        log.error("credentials", "Token renewal via claude CLI failed");
        return false;
      }

      log.info("credentials", "Token renewed successfully via claude CLI");

      // Re-read the now-fresh credentials from Keychain
      credentials = await readFromKeychain();
      if (!credentials) {
        log.error("credentials", "No credentials in Keychain after renewal — unexpected");
        return false;
      }
      // Guard against writing a still-expired token as "fresh": the PTY
      // echo check is a proxy for "Claude responded", not proof that the
      // Keychain entry was actually refreshed.
      if (isTokenExpired(credentials)) {
        log.error("credentials", "Token still expired after renewal — Keychain was not refreshed");
        return false;
      }
    } else {
      try {
        const creds: CredentialsJson = JSON.parse(credentials);
        const expiresAt = creds.claudeAiOauth?.expiresAt ?? "unknown";
        log.info("credentials", `Access token is valid, expires at ${expiresAt}`);
      } catch {
        log.info("credentials", "Access token appears valid");
      }
    }

    // Atomic so a readers mid-refresh can't see a truncated creds
    // file; mode preserves the 0o600 we always set on this file.
    await writeFileAtomic(CREDENTIALS_PATH, credentials + "\n", { mode: 0o600 });
    log.info("credentials", "Fresh credentials written to ~/.claude/.credentials.json");
    return true;
  } catch (err) {
    log.error("credentials", "Failed to refresh credentials from Keychain", {
      error: String(err),
    });
    return false;
  }
}
