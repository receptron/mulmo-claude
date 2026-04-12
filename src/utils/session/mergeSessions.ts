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
function buildLiveSummary(
  live: ActiveSession,
  serverEntry: SessionSummary | undefined,
): SessionSummary {
  const firstUserMsg = live.toolResults.find(isUserTextResponse);
  const preview = serverEntry?.preview || (firstUserMsg?.message ?? "");
  const base: SessionSummary = {
    id: live.id,
    roleId: live.roleId,
    startedAt: live.startedAt,
    updatedAt: live.updatedAt,
    preview,
  };
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
  };
}

// Compare two summaries for sort order. Newest `updatedAt` wins;
// if updatedAt ties (same second-granularity mtime on two
// server-only rows, say), fall back to `startedAt`. Exported so
// tests can exercise the tie-break directly.
export function compareSessionsByRecency(
  a: SessionSummary,
  b: SessionSummary,
): number {
  const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (byUpdated !== 0) return byUpdated;
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

// Merge live sessions (in-memory, still editable) with server
// summaries (from /api/sessions). Live sessions always win for
// the same id — we prefer the local state we know is current —
// but pull over the server's AI title / summary / keywords when
// present. Pure, returns a new array; does not mutate inputs.
export function mergeSessionLists(
  liveSessions: readonly ActiveSession[],
  serverSessions: readonly SessionSummary[],
): SessionSummary[] {
  const liveIds = new Set(liveSessions.map((s) => s.id));
  const serverById = new Map<string, SessionSummary>(
    serverSessions.map((s) => [s.id, s]),
  );
  const liveSummaries = liveSessions.map((live) =>
    buildLiveSummary(live, serverById.get(live.id)),
  );
  const serverOnly = serverSessions.filter((s) => !liveIds.has(s.id));
  return [...liveSummaries, ...serverOnly].sort(compareSessionsByRecency);
}
