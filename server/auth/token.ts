// Bearer auth token (#272). One random 32-byte hex token per server
// startup, held in memory and mirrored to a 0600 file at
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

import { randomBytes } from "crypto";
import fs from "fs";
import { writeFileAtomic } from "../utils/file.js";
import { WORKSPACE_PATHS } from "../workspace-paths.js";

const TOKEN_BYTES = 32; // 64 hex chars

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
 * Generate a fresh random token, store it in memory, and mirror to the
 * workspace file (mode 0600, atomic). The `tokenPath` parameter is
 * injected for tests so they can target a tmp directory; production
 * callers rely on the default `WORKSPACE_PATHS.sessionToken`.
 */
export async function generateAndWriteToken(
  tokenPath: string = WORKSPACE_PATHS.sessionToken,
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  currentToken = token;
  await writeFileAtomic(tokenPath, token, { mode: 0o600 });
  return token;
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
