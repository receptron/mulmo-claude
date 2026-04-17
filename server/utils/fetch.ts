// Helpers for server-side fetch() calls. The MCP stdio bridge
// (`server/agent/mcp-server.ts`) makes multiple fetch calls to
// the host Express server and repeated the same error-extraction
// pattern at every call site.

import { isRecord } from "./types.js";

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
