// Resolve the bearer token the CLI bridge sends to /api/*. Used by
// bridges/cli/index.ts at startup (#272 Phase 2).
//
// Resolution order:
//   1. `MULMOCLAUDE_AUTH_TOKEN` env var (useful for parallel shells,
//      CI, or when the user runs the bridge against a different
//      workspace than ~/mulmoclaude/)
//   2. `<homedir>/mulmoclaude/.session-token` — the file the server
//      writes at startup. Same path the Vite dev plugin reads from.
//
// Returns null if neither source yields a non-empty string — the
// caller decides how to react (exit with a helpful message, in the
// bridge's case).

import fs from "fs";
import os from "os";
import path from "path";

export const TOKEN_FILE_PATH = path.join(
  os.homedir(),
  "mulmoclaude",
  ".session-token",
);

export function readBridgeToken(): string | null {
  const fromEnv = process.env.MULMOCLAUDE_AUTH_TOKEN;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  try {
    const raw = fs.readFileSync(TOKEN_FILE_PATH, "utf-8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}
