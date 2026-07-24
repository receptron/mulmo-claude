// Helpers for server-side fetch() calls. The MCP stdio bridge
// (`server/agent/mcp-server.ts`) makes multiple fetch calls to the host Express
// server and repeated the same error-extraction pattern at every call site.
//
// `fetchWithTimeout` / `FetchWithTimeoutInit` / `DEFAULT_FETCH_TIMEOUT_MS` live in
// `@mulmoclaude/core/fetch` so the host, the collection registry engine and the
// Google engine share one implementation — before #2398 the same helper existed
// three times, so #2221's caller-signal-composition fix could only land in one.
// Re-exported (rather than repointing every call site) to keep
// `server/utils/fetch.js` the name host code reaches for.
import { isRecord } from "./types.js";

export { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchWithTimeoutInit } from "@mulmoclaude/core/fetch";

/**
 * Extract a human-readable error string from a non-ok fetch Response.
 *
 * Tries to parse the body as `{ error: string }` (the shape every
 * MulmoClaude `/api/*` endpoint returns on failure). Falls back to
 * `"HTTP <status>"` when the body isn't JSON, isn't a plain object,
 * or doesn't contain an `error` string field.
 */
export async function extractFetchError(res: Response): Promise<string> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return `HTTP ${res.status}`;
  }
  if (isRecord(body) && typeof body.error === "string") {
    return body.error;
  }
  return `HTTP ${res.status}`;
}
