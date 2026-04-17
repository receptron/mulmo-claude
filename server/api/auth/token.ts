// Bearer auth token (#272). One 32-byte hex token per server startup,
// held in memory and mirrored to a 0600 file at
// `WORKSPACE_PATHS.sessionToken`.
//
// **Why file-backed**: the token must travel out-of-process to (a) the
// Vite dev server's `transformIndexHtml` plugin so it can embed the
// token in the HTML Vue receives, and (b) CLI bridges (Phase 2) that
// share the workspace but live in a different process. Memory-only
// would force every reader to go through HTTP, which is the
// chicken-and-egg problem bearer auth is trying to fix.
//
// **Lifecycle**: generate on startup, write atomic, delete on graceful
// shutdown. A stale file after a crash is harmless — the next startup
// generates a fresh in-memory token and overwrites, so a stolen stale
// file value fails 401 against the running server.
//
// **Env override (#316)**: `MULMOCLAUDE_AUTH_TOKEN` (read via `env.ts`)
// pins the token across restarts so long-running bridges don't need a
// relaunch every time the server bounces. The client-side readers
// (`bridges/_lib/token.ts`, Vite plugin) already honour the same var;
// setting it once on both sides survives restarts.

import { randomBytes } from "crypto";
import fs from "fs";
import { writeFileAtomic } from "../../utils/files/index.js";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { log } from "../../system/logger/index.js";

const TOKEN_BYTES = 32; // 64 hex chars
// Below this length a random 32-byte token would be 64 hex chars;
// anything shorter from the env override is almost certainly a
// placeholder like "test" that leaked into production. Warn, don't
// block — the operator might have reasons we don't see.
const MIN_RECOMMENDED_CHARS = 32;

let currentToken: string | null = null;

/**
 * The token the server is currently using. Null until
 * `generateAndWriteToken` has been called. `bearerAuth` reads this on
 * every request.
 */
export function getCurrentToken(): string | null {
  return currentToken;
}

/**
 * Generate (or take from the env override) the startup token, store
 * it in memory, and mirror it to the workspace file (mode 0600,
 * atomic).
 *
 * @param tokenPath Injected for tests so they can target a tmp
 *   directory; production callers rely on the default
 *   `WORKSPACE_PATHS.sessionToken`.
 * @param override Injected for tests. Production callers pass
 *   `env.authTokenOverride` from `server/env.ts`. When non-empty the
 *   override is used verbatim instead of generating random bytes.
 */
export async function generateAndWriteToken(
  tokenPath: string = WORKSPACE_PATHS.sessionToken,
  override?: string,
): Promise<string> {
  const token = resolveToken(override);
  currentToken = token;
  await writeFileAtomic(tokenPath, token, { mode: 0o600 });
  return token;
}

function resolveToken(override: string | undefined): string {
  if (typeof override === "string" && override.length > 0) {
    if (override.length < MIN_RECOMMENDED_CHARS) {
      // Visible on startup so a half-typed override doesn't silently
      // become a security hole in dev.
      log.warn(
        "auth",
        "MULMOCLAUDE_AUTH_TOKEN is shorter than the recommended 32 characters",
        { length: override.length },
      );
    }
    return override;
  }
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * Best-effort removal of the token file. Never throws; a missing file
 * is a success for our purposes (nothing to clean up). Caller is
 * responsible for not using the in-memory token after calling this.
 */
export async function deleteTokenFile(
  tokenPath: string = WORKSPACE_PATHS.sessionToken,
): Promise<void> {
  try {
    await fs.promises.unlink(tokenPath);
  } catch {
    /* already gone — nothing to do */
  }
}

/**
 * Test-only: reset module state so a suite can simulate fresh startup
 * without reloading the module. Not exported to production callers.
 */
export function __resetForTests(): void {
  currentToken = null;
}
