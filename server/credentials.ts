import { execFile } from "child_process";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { promisify } from "util";
import { log } from "./logger/index.js";

const execFileAsync = promisify(execFile);

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Safety margin — treat tokens as expired 60s before actual expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Maximum time to wait for the claude CLI to respond. */
const PTY_TIMEOUT_MS = 30_000;
/** Delay before sending input to the claude CLI. */
const PTY_INPUT_DELAY_MS = 3_000;

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
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ]);
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

    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      proc.kill();
      resolve(success);
    };

    const timeout = setTimeout(() => {
      log.error("credentials", "Token renewal timed out after 30s");
      finish(false);
    }, PTY_TIMEOUT_MS);

    // Match "hi" as a whole token so unrelated output containing those
    // bytes (e.g. ANSI sequences, words like "This" or "high") can't
    // false-positive the echo detection.
    const ECHO_RE = /\bhi\b/;

    proc.onData((data: string) => {
      buffer += data;

      if (!responded && ECHO_RE.test(buffer)) {
        // Claude echoed our "hi" — now wait for the actual response
        responded = true;
        return;
      }

      if (responded) {
        // Got something after "hi" — credentials renewed
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
        log.warn(
          "credentials",
          `Access token expired at ${expiresAt}, launching claude CLI to renew...`,
        );
      } catch {
        log.warn(
          "credentials",
          "Access token expired (could not parse expiry), launching claude CLI to renew...",
        );
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
        log.error(
          "credentials",
          "No credentials in Keychain after renewal — unexpected",
        );
        return false;
      }
      // Guard against writing a still-expired token as "fresh": the PTY
      // echo check is a proxy for "Claude responded", not proof that the
      // Keychain entry was actually refreshed.
      if (isTokenExpired(credentials)) {
        log.error(
          "credentials",
          "Token still expired after renewal — Keychain was not refreshed",
        );
        return false;
      }
    } else {
      try {
        const creds: CredentialsJson = JSON.parse(credentials);
        const expiresAt = creds.claudeAiOauth?.expiresAt ?? "unknown";
        log.info(
          "credentials",
          `Access token is valid, expires at ${expiresAt}`,
        );
      } catch {
        log.info("credentials", "Access token appears valid");
      }
    }

    await writeFile(CREDENTIALS_PATH, credentials + "\n");
    log.info(
      "credentials",
      "Fresh credentials written to ~/.claude/.credentials.json",
    );
    return true;
  } catch (err) {
    log.error("credentials", "Failed to refresh credentials from Keychain", {
      error: String(err),
    });
    return false;
  }
}
