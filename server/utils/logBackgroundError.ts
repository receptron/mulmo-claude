import { log } from "../system/logger/index.js";

/**
 * Build a `.catch` handler for a fire-and-forget background job that
 * logs the failure under the given prefix. Consolidates the
 * "unexpected error in background" pattern used across journal,
 * chat-index, wiki-backlinks, tool-trace, etc.
 *
 * Usage:
 *
 *   maybeRunJournal({ ... }).catch(logBackgroundError("journal"));
 *
 * The handler never rethrows — the caller's promise chain is
 * terminated cleanly so nothing propagates into the request path.
 */
export function logBackgroundError(prefix: string): (err: unknown) => void {
  return (err) => {
    log.warn(prefix, "unexpected error in background", {
      error: String(err),
    });
  };
}
