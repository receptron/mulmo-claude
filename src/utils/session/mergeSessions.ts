// Pure helper: merge the two views of "sessions" that the sidebar
// history pane shows — live in-memory sessions (from `sessionMap`)
// and server-persisted summaries (from `/api/sessions`). Extracted
// from `src/App.vue` as part of the cognitive-complexity refactor
// tracked in #175.
//
// The merge is deterministic given the inputs: the test suite pins
// every edge case we've hit (live-only, server-only, overlap,
// server-side AI title vs local first-user-message, sort tie-breaks).

import { isUserTextResponse } from "../tools/result";
import type { SessionSummary, ActiveSession } from "../../types/session";

// Build the summary shape the sidebar expects for a single live
// session. Server-side data (AI-generated title, summary,
// keywords) takes precedence over the local first-user-message
// heuristic — otherwise opening an indexed session in a new tab
// would regress the sidebar row to the raw first message.
function buildLiveSummary(live: ActiveSession, serverEntry: SessionSummary | undefined): SessionSummary {
  const firstUserMsg = live.toolResults.find(isUserTextResponse);
  const preview = serverEntry?.preview || (firstUserMsg?.message ?? "");
  const base: SessionSummary = {
    id: live.id,
    roleId: live.roleId,
    startedAt: live.startedAt,
    updatedAt: live.updatedAt,
    preview,
  };
  // Fold every in-memory signal into isRunning so the sidebar spinner
  // reacts as fast as the fastest source:
  //   - serverEntry.isRunning: authoritative but arrives on a /api/sessions
  //     refetch
  //   - live.isRunning: mirrored from the server via refreshSessionStates;
  //     may be ahead during the refetch window, and covers live-only
  //     sessions with no serverEntry yet
  //   - live.pendingGenerations: updates on the socket round-trip of a
  //     generationStarted event, before any REST refetch
  // OR them so any one is enough. `live.isRunning` is always defined on
  // an ActiveSession, so the summary always carries a boolean here.
  const pending = live.pendingGenerations ?? {};
  const isRunning = Boolean(serverEntry?.isRunning) || live.isRunning || Object.keys(pending).length > 0;
  // Carry summary / keywords ONLY if the server already has them.
  // Object-spread with a conditional object keeps us from adding
  // `undefined` values that would otherwise show up as explicit
  // `summary: undefined` in a later shallow-copy.
  return {
    ...base,
    ...(serverEntry?.summary !== undefined && { summary: serverEntry.summary }),
    ...(serverEntry?.keywords !== undefined && {
      keywords: serverEntry.keywords,
    }),
    // `origin` is set once by the server when the session is created
    // (scheduler / skill / bridge / human). A live session promoted
    // from the server list must keep it — the tab bar renders the
    // non-human glyph off this field.
    ...(serverEntry?.origin !== undefined && { origin: serverEntry.origin }),
    ...(serverEntry?.isBookmarked !== undefined && {
      isBookmarked: serverEntry.isBookmarked,
    }),
    isRunning,
    ...(serverEntry?.hasUnread !== undefined && {
      hasUnread: serverEntry.hasUnread,
    }),
    ...(serverEntry?.statusMessage !== undefined && {
      statusMessage: serverEntry.statusMessage,
    }),
  };
}

// Compare two summaries for sort order. Newest `updatedAt` wins;
// if updatedAt ties (same second-granularity mtime on two
// server-only rows, say), fall back to `startedAt`. Exported so
// tests can exercise the tie-break directly.
export function compareSessionsByRecency(left: SessionSummary, right: SessionSummary): number {
  const byUpdated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (byUpdated !== 0) return byUpdated;
  return Date.parse(right.startedAt) - Date.parse(left.startedAt);
}

// Merge live sessions (in-memory, still editable) with server
// summaries (from /api/sessions). Live sessions always win for
// the same id — we prefer the local state we know is current —
// but pull over the server's AI title / summary / keywords when
// present. Pure, returns a new array; does not mutate inputs.
export function mergeSessionLists(liveSessions: readonly ActiveSession[], serverSessions: readonly SessionSummary[]): SessionSummary[] {
  const liveIds = new Set(liveSessions.map((session) => session.id));
  const serverById = new Map<string, SessionSummary>(serverSessions.map((session) => [session.id, session]));
  const liveSummaries = liveSessions.map((live) => buildLiveSummary(live, serverById.get(live.id)));
  const serverOnly = serverSessions.filter((session) => !liveIds.has(session.id));
  return [...liveSummaries, ...serverOnly].sort(compareSessionsByRecency);
}

// Apply a server-sent diff to the client's cached session list
// (see issue #205). `diff` holds rows the server says have changed
// since the client's last cursor — each replaces any existing row
// with the same id, or is prepended if new. `deletedIds` removes
// rows the server has forgotten; always empty today (no
// session-delete code path exists) but the shape is plumbed through
// so populating it becomes a server-only change later.
//
// Pure; returns a new array sorted by the same recency rule
// `mergeSessionLists` uses, so the two are interchangeable at call
// sites that don't care which they got.
export function applySessionDiff(cache: readonly SessionSummary[], diff: readonly SessionSummary[], deletedIds: readonly string[]): SessionSummary[] {
  const deleted = new Set(deletedIds);
  const diffById = new Map<string, SessionSummary>(diff.map((session) => [session.id, session]));
  const kept = cache.filter((session) => !deleted.has(session.id)).map((session) => diffById.get(session.id) ?? session);
  const existingIds = new Set(kept.map((session) => session.id));
  const added = diff.filter((session) => !existingIds.has(session.id));
  return [...kept, ...added].sort(compareSessionsByRecency);
}
