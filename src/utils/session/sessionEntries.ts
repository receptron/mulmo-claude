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
      out.push(makeTextResult(entry.message, entry.source, entry.attachments));
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
//      bookmarks restore the exact result the user was viewing —
//      we honour even sidebar-hidden uuids here because the URL is
//      an explicit user choice (a fresh "auto-pick" should never
//      land on a hidden result, but a deliberate bookmark can).
//   2. Otherwise fall back to the heuristic over visible-only
//      results: the most recent non-text tool result (images, wiki
//      pages, etc. carry more visual information than bare text).
//   3. If there are no non-text visible results, use the last
//      visible result of any kind.
//   4. If the list is empty, return null.
//
// `isVisible` is injected (rather than imported here) so this
// module stays Vue-free for `node:test` consumers; the live App
// passes `isSidebarVisible` from `sidebarVisibleApp`. The default
// `() => true` matches pre-filter behaviour for tests that don't
// supply one.
export function resolveSelectedUuid(
  toolResults: readonly ToolResultComplete[],
  urlResult: string | null,
  isVisible: (result: ToolResultComplete) => boolean = () => true,
): string | null {
  if (urlResult && toolResults.some((result) => result.uuid === urlResult)) {
    return urlResult;
  }
  const visible = toolResults.filter(isVisible);
  if (visible.length === 0) return null;
  // Iterate backwards for the "last non-text" lookup so callers
  // don't pay for an intermediate reverse copy.
  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].toolName !== "text-response") {
      return visible[i].uuid;
    }
  }
  return visible[visible.length - 1].uuid;
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
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(updatedAt).getTime();
  toolResults.forEach((result, i) => {
    const frac = toolResults.length > 1 ? i / (toolResults.length - 1) : 0;
    timestamps.set(result.uuid, startMs + (endMs - startMs) * frac);
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
  /** Visibility predicate for the auto-select heuristic — defaults
   *  to `() => true` so this module stays Vue-free for tests; the
   *  App wires `isSidebarVisible` from `sidebarVisibleApp`. */
  isVisible?: (result: ToolResultComplete) => boolean;
}): ActiveSession {
  const { id, entries, defaultRoleId, urlResult, serverSummary, nowIso, isVisible } = opts;
  const meta = entries.find((entry) => entry.type === EVENT_TYPES.sessionMeta);
  const roleId = meta?.roleId ?? defaultRoleId;
  const toolResults = parseSessionEntries(entries);
  const selectedResultUuid = resolveSelectedUuid(toolResults, urlResult, isVisible);
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
