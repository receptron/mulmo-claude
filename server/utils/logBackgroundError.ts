import { log } from "../system/logger/index.js";
import { errorMessage } from "./errors.js";

/**
 * Build a `.catch` handler for a fire-and-forget background job that
 * logs the failure under the given prefix. Consolidates the
 * "unexpected error in background" pattern used across journal,
 * chat-index, wiki-backlinks, tool-trace, etc.
 *
 * Usage:
 *
 *   // Default message — good for generic background scans.
 *   maybeRunJournal({ ... }).catch(logBackgroundError("journal"));
 *
 *   // Custom message — pass context when the failure mode is
 *   // worth surfacing distinctly (e.g. "failed to register
 *   // scheduled skills" vs other `skills` warnings).
 *   registerScheduledSkills(...).catch(
 *     logBackgroundError("skills", "failed to register scheduled skills"),
 *   );
 *
 * The handler never rethrows — the caller's promise chain is
 * terminated cleanly so nothing propagates into the request path.
 */
export function logBackgroundError(prefix: string, message = "unexpected error in background"): (err: unknown) => void {
  return (err) => {
    log.warn(prefix, message, {
      error: errorMessage(err),
    });
  };
}
