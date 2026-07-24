import { execFile } from "child_process";
import { promisify } from "util";
import { chmodSync, existsSync, readdirSync, statSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { log } from "./logger/index.js";
import { isRecord } from "../utils/types.js";
import { ONE_SECOND_MS, ONE_MINUTE_MS } from "../utils/time.js";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { claudeCredentialsPath } from "../utils/claudeConfigPath.js";

const execFileAsync = promisify(execFile);

const SPAWN_HELPER_EXEC_BITS = 0o111;

const CREDENTIALS_PATH = claudeCredentialsPath();
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** Safety margin — treat tokens as expired 60s before actual expiry. */
const EXPIRY_MARGIN_MS = ONE_MINUTE_MS;
/** Maximum time to wait for the claude CLI to respond. */
const PTY_TIMEOUT_MS = 30 * ONE_SECOND_MS;
/** Delay before sending input to the claude CLI. */
const PTY_INPUT_DELAY_MS = 3 * ONE_SECOND_MS;

// After the echo, only treat output as a successful renewal when it
// looks like a real Claude response — a conversational opener
// (Hello / Hi / I'm / …) AND a non-trivial amount of text. Error
// chunks ("Please log in", "Invalid credentials", network blips)
// don't match both conditions, so they fall through to the timeout and
// we treat the renewal as failed. A final safety net: refreshCredentials()
// re-reads the Keychain and calls isTokenExpired() before writing, so
// even a false positive here can't persist a stale token.
const RESPONSE_PATTERN_RE = /\b(Hello|Hi|I['’]m|I can|How can)\b/i;
const MIN_RESPONSE_CHARS = 20;

export function looksLikeClaudeResponse(text: string): boolean {
  return RESPONSE_PATTERN_RE.test(text) && text.length >= MIN_RESPONSE_CHARS;
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

/** The token's expiry as epoch milliseconds, or null when the JSON is
 *  unparseable or carries no usable expiry.
 *
 *  Claude's Keychain blob stores `expiresAt` as a number (epoch ms); older CLI
 *  builds wrote an ISO string. Accept both. A prior `typeof === "string"` guard
 *  silently rejected the numeric form, so every token read as "no expiry →
 *  expired" and forced a PTY renew of the CLI on every Docker run. */
export function readExpiresAt(raw: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const oauth = parsed.claudeAiOauth;
  if (!isRecord(oauth)) return null;
  const { expiresAt } = oauth;
  if (typeof expiresAt === "number") return Number.isFinite(expiresAt) ? expiresAt : null;
  if (typeof expiresAt === "string") {
    const parsedMs = Date.parse(expiresAt);
    return Number.isNaN(parsedMs) ? null : parsedMs;
  }
  return null;
}

function isTokenExpired(raw: string): boolean {
  const expiresMs = readExpiresAt(raw);
  if (expiresMs === null) return true; // no usable expiry — treat as expired
  return Date.now() >= expiresMs - EXPIRY_MARGIN_MS;
}

/**
 * Spawn `claude` interactively via a PTY to force the CLI to refresh its
 * OAuth token. The CLI handles the refresh internally and writes the new
 * token back to the macOS Keychain.
 */
function awaitTokenRenewal(pty: typeof import("node-pty")): Promise<boolean> {
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
      if (looksLikeClaudeResponse(response)) {
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

/** node-pty's prebuilds directory, resolved from wherever it's installed
 *  (hoisted or nested), or null when node-pty can't be found. */
export function nodePtyPrebuildsDir(): string | null {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve("node-pty"));
    while (dir !== dirname(dir)) {
      if (existsSync(join(dir, "prebuilds"))) return join(dir, "prebuilds");
      dir = dirname(dir);
    }
  } catch {
    // node-pty not resolvable — nothing to fix
  }
  return null;
}

/** Restore +x on one prebuild's `spawn-helper`, if it's a regular file that
 *  lacks it. Errors are per-entry so one bad platform bundle can't abort the
 *  repair of the others. */
function restoreSpawnHelperExec(helper: string): void {
  try {
    if (!existsSync(helper)) return;
    const info = statSync(helper);
    if (!info.isFile()) return;
    if ((info.mode | SPAWN_HELPER_EXEC_BITS) !== info.mode) chmodSync(helper, info.mode | SPAWN_HELPER_EXEC_BITS);
  } catch {
    // best-effort — skip this entry, keep repairing the rest
  }
}

/** Runtime backstop for `posix_spawnp failed`. node-pty execs its prebuilt
 *  `spawn-helper` before the target command, but ships it mode 644 in the npm
 *  tarball; an install that skipped lifecycle scripts (`--ignore-scripts`,
 *  some `npm ci` setups) leaves it non-executable and every spawn throws. The
 *  postinstall normally restores +x — this covers installs that never ran it,
 *  so it also protects end users who never run the test suite. Best-effort:
 *  any failure is swallowed and we still attempt the spawn. */
export function ensureSpawnHelperExecutable(): void {
  const prebuilds = nodePtyPrebuildsDir();
  if (prebuilds === null) return;
  let platforms: string[];
  try {
    platforms = readdirSync(prebuilds);
  } catch {
    return;
  }
  for (const platform of platforms) restoreSpawnHelperExec(join(prebuilds, platform, "spawn-helper"));
}

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

  ensureSpawnHelperExecutable();
  return awaitTokenRenewal(pty);
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
      const expiresMs = readExpiresAt(credentials);
      log.warn(
        "credentials",
        expiresMs !== null
          ? `Access token expired at ${new Date(expiresMs).toISOString()}, launching claude CLI to renew...`
          : "Access token expired (could not parse expiry), launching claude CLI to renew...",
      );

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
      const expiresMs = readExpiresAt(credentials);
      log.info("credentials", expiresMs !== null ? `Access token is valid, expires at ${new Date(expiresMs).toISOString()}` : "Access token appears valid");
    }

    // Atomic so a readers mid-refresh can't see a truncated creds
    // file; mode preserves the 0o600 we always set on this file.
    await writeFileAtomic(CREDENTIALS_PATH, `${credentials}\n`, { mode: 0o600 });
    log.info("credentials", "Fresh credentials written to ~/.claude/.credentials.json");
    return true;
  } catch (err) {
    log.error("credentials", "Failed to refresh credentials from Keychain", {
      error: String(err),
    });
    return false;
  }
}
