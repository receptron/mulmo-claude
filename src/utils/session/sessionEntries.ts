// Pure helpers for reconstructing an `ActiveSession`'s runtime
// shape from the `/api/sessions/:id` JSONL payload. Extracted from
// `src/App.vue#loadSession` so the parse / select / timestamp-
// resolution logic is unit-testable without mocking `fetch`.
//
// Tracks #175.

import { makeTextResult } from "../tools/result";
import { isTextEntry, isToolResultEntry, type ActiveSession, type SessionEntry, type SessionSummary } from "../../types/session";
import { EVENT_TYPES } from "../../types/events";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

// Walk the server's session entries and produce the flat
// `toolResults` array the client keeps in `ActiveSession`. Drops
// `session_meta` rows (they're metadata, not a result), converts
// text entries into tool-result-shaped envelopes via
// `makeTextResult`, and passes tool_result entries through verbatim.
export function parseSessionEntries(entries: readonly SessionEntry[]): ToolResultComplete[] {
  const out: ToolResultComplete[] = [];
  for (const entry of entries) {
    if (entry.type === EVENT_TYPES.sessionMeta) continue;
    if (isTextEntry(entry)) {
      out.push(makeTextResult(entry.message, entry.source));
    } else if (isToolResultEntry(entry)) {
      out.push(entry.result);
    }
  }
  return out;
}

// Pick the `selectedResultUuid` the session should restore to.
// Rules:
//   1. If the URL carries `?result=<uuid>` AND that uuid actually
//      exists in the loaded list, honour it verbatim. This lets
//      bookmarks restore the exact result the user was viewing.
//   2. Otherwise fall back to the heuristic: the most recent
//      non-text tool result (images, wiki pages, etc. carry more
//      visual information than bare text).
//   3. If there are no non-text results, use the last result of
//      any kind.
//   4. If the list is empty, return null.
export function resolveSelectedUuid(toolResults: readonly ToolResultComplete[], urlResult: string | null): string | null {
  if (urlResult && toolResults.some((r) => r.uuid === urlResult)) {
    return urlResult;
  }
  // Iterate backwards for the "last non-text" lookup so callers
  // don't pay for an intermediate reverse copy.
  for (let i = toolResults.length - 1; i >= 0; i--) {
    if (toolResults[i].toolName !== "text-response") {
      return toolResults[i].uuid;
    }
  }
  const last = toolResults[toolResults.length - 1];
  return last?.uuid ?? null;
}

// Decide the `startedAt` / `updatedAt` to seed the in-memory
// ActiveSession with. We prefer the server summary's timestamps
// so the restored session keeps its existing sidebar ordering;
// we fall through to the current clock only if the server
// summary is missing (e.g. freshly-created session that hasn't
// round-tripped through `/api/sessions` yet).
//
// Keeping this logic named lets the test suite pin the
// "updatedAt missing → fall back to startedAt" rule explicitly,
// which was previously a fragile `??` chain buried in loadSession.
export function resolveSessionTimestamps(serverSummary: SessionSummary | undefined, nowIso: string): { startedAt: string; updatedAt: string } {
  const startedAt = serverSummary?.startedAt ?? nowIso;
  const updatedAt = serverSummary?.updatedAt ?? startedAt;
  return { startedAt, updatedAt };
}

// Spread toolResults evenly between startedAt and updatedAt to
// approximate per-entry timestamps for sessions loaded from disk.
// Real-time results will overwrite with Date.now() via pushResult.
export function interpolateTimestamps(toolResults: readonly ToolResultComplete[], startedAt: string, updatedAt: string): Map<string, number> {
  const timestamps = new Map<string, number>();
  const t0 = new Date(startedAt).getTime();
  const t1 = new Date(updatedAt).getTime();
  toolResults.forEach((r, i) => {
    const frac = toolResults.length > 1 ? i / (toolResults.length - 1) : 0;
    timestamps.set(r.uuid, t0 + (t1 - t0) * frac);
  });
  return timestamps;
}

// Build an ActiveSession from server-fetched entries + metadata.
// Pure — the caller is responsible for inserting into sessionMap
// and subscribing.
export function buildLoadedSession(opts: {
  id: string;
  entries: readonly SessionEntry[];
  defaultRoleId: string;
  urlResult: string | null;
  serverSummary: SessionSummary | undefined;
  nowIso: string;
}): ActiveSession {
  const { id, entries, defaultRoleId, urlResult, serverSummary, nowIso } = opts;
  const meta = entries.find((e) => e.type === EVENT_TYPES.sessionMeta);
  const roleId = meta?.roleId ?? defaultRoleId;
  const toolResults = parseSessionEntries(entries);
  const selectedResultUuid = resolveSelectedUuid(toolResults, urlResult);
  const { startedAt, updatedAt } = resolveSessionTimestamps(serverSummary, nowIso);
  const resultTimestamps = interpolateTimestamps(toolResults, startedAt, updatedAt);

  return {
    id,
    roleId,
    toolResults,
    resultTimestamps,
    isRunning: serverSummary?.isRunning ?? false,
    statusMessage: serverSummary?.statusMessage ?? "",
    toolCallHistory: [],
    selectedResultUuid,
    hasUnread: serverSummary?.hasUnread ?? false,
    startedAt,
    updatedAt,
    runStartIndex: toolResults.length,
    pendingGenerations: {},
  };
}
