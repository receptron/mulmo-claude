// Public entry point for the chat index. The agent route calls
// `maybeIndexSession({ sessionId, activeSessionIds })` from its
// `finally` block — fire-and-forget. This module:
//
//   - skips sessions still being written by a concurrent request
//   - holds a per-session lock so double-fires for the same id
//     become no-ops (two sessions can still index in parallel)
//   - catches ClaudeCliNotFoundError and disables itself for the
//     rest of the process lifetime to avoid spamming warnings
//   - catches unexpected errors and logs them so nothing bubbles
//     back into the request handler
//
// All functions accept an explicit `workspaceRoot` so tests can
// point at a `mkdtempSync` directory.

import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { ClaudeCliNotFoundError } from "../journal/archivist.js";
import { indexSession, listSessionIds, type IndexerDeps } from "./indexer.js";

// Per-session lock. Indexing different sessions in parallel is
// fine; indexing the same session twice concurrently would just
// burn CLI budget for no benefit.
const running = new Set<string>();

// Flipped once we hit ENOENT on the `claude` CLI so we stop
// trying for the lifetime of the server process. Reset on
// restart.
let disabled = false;

export interface MaybeIndexSessionOptions {
  sessionId: string;
  // Skip indexing if the session is still being appended to by a
  // concurrent /api/agent request — the jsonl may be mid-write.
  // Ignored when `force` is true so manual rebuild runs can
  // re-index even a live session (accepting that the transcript
  // may be slightly out of date).
  activeSessionIds?: ReadonlySet<string>;
  workspaceRoot?: string;
  deps?: IndexerDeps;
  // Bypass the activeSessionIds guard and the isFresh throttle
  // for this call. The per-session lock and the `disabled`
  // sentinel are still respected — forcing doesn't help if the
  // claude CLI is missing or the same session is already in
  // flight.
  force?: boolean;
}

// Fire-and-forget entry point. Errors are swallowed here; a
// defensive `.catch(...)` at the call site is still recommended.
export async function maybeIndexSession(
  opts: MaybeIndexSessionOptions,
): Promise<void> {
  if (disabled) return;

  const { sessionId } = opts;
  const force = opts.force === true;
  if (!force && opts.activeSessionIds?.has(sessionId)) return;
  if (running.has(sessionId)) return;

  // Thread `force` through the indexer via IndexerDeps so the
  // freshness throttle is also bypassed on forced runs.
  const effectiveDeps: IndexerDeps = {
    ...(opts.deps ?? {}),
    ...(force ? { force: true } : {}),
  };

  running.add(sessionId);
  try {
    await indexSession(
      opts.workspaceRoot ?? defaultWorkspacePath,
      sessionId,
      effectiveDeps,
    );
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) {
      disabled = true;
      // eslint-disable-next-line no-console
      console.warn(err.message);
      return;
    }
    // eslint-disable-next-line no-console
    console.warn("[chat-index] unexpected failure, continuing:", err);
  } finally {
    running.delete(sessionId);
  }
}

// Debug helper: index every session jsonl under workspace/chat/
// sequentially with `force: true`. Used by the manual rebuild
// endpoint and the CHAT_INDEX_FORCE_RUN_ON_STARTUP switch so the
// user can populate titles for existing sessions without waiting
// for each one to be revisited.
//
// Returns counts for logging. Errors on individual sessions do
// not stop the walk — the failure is logged and processing
// continues.
export interface BackfillResult {
  total: number;
  indexed: number;
  skipped: number;
}

export async function backfillAllSessions(
  opts: {
    workspaceRoot?: string;
    deps?: IndexerDeps;
  } = {},
): Promise<BackfillResult> {
  const workspaceRoot = opts.workspaceRoot ?? defaultWorkspacePath;
  const ids = await listSessionIds(workspaceRoot);
  const result: BackfillResult = {
    total: ids.length,
    indexed: 0,
    skipped: 0,
  };
  for (const sessionId of ids) {
    if (disabled) {
      result.skipped++;
      continue;
    }
    try {
      const entry = await indexSession(workspaceRoot, sessionId, {
        ...(opts.deps ?? {}),
        force: true,
      });
      if (entry) {
        result.indexed++;
        // eslint-disable-next-line no-console
        console.log(`[chat-index] indexed ${sessionId}: ${entry.title}`);
      } else {
        result.skipped++;
      }
    } catch (err) {
      if (err instanceof ClaudeCliNotFoundError) {
        disabled = true;
        // eslint-disable-next-line no-console
        console.warn(err.message);
        result.skipped++;
        continue;
      }
      result.skipped++;
      // eslint-disable-next-line no-console
      console.warn(`[chat-index] failed to index ${sessionId}:`, err);
    }
  }
  return result;
}

// Internal hook: tests need to reset the module-level `disabled`
// and `running` state between cases because node:test doesn't
// reload modules. Not part of the public runtime contract.
export function __resetForTests(): void {
  disabled = false;
  running.clear();
}
