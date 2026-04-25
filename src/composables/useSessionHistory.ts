// Composable for the session-history view at `/history`.
//
// Owns the `sessions` list (what the server knows about) plus the
// fetch helper. The view's open/closed state is now URL-backed (see
// plans/done/feat-history-url-route.md) — callers watch `route.name` and
// invoke `fetchSessions()` on route enter rather than going through
// an in-memory toggle flag.
//
// Since #205, `fetchSessions()` sends the server's last-issued
// cursor back as `?since=<cursor>` so the server can reply with
// only the rows that changed. The first call has no cursor (full
// fetch); subsequent calls receive a diff that we merge into the
// existing cache via `applySessionDiff`.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import type { SessionSummary } from "../types/session";
import { apiGet } from "../utils/api";
import { applySessionDiff } from "../utils/session/mergeSessions";

interface SessionsResponse {
  sessions: SessionSummary[];
  cursor: string;
  deletedIds: string[];
}

export function useSessionHistory(): {
  sessions: Ref<SessionSummary[]>;
  historyError: Ref<string | null>;
  fetchSessions: () => Promise<SessionSummary[]>;
} {
  const sessions = ref<SessionSummary[]>([]);
  // Surfaces the most recent fetch failure. Kept alongside the (stale)
  // sessions list rather than wiping it — a panel that goes blank
  // the moment the network hiccups is worse UX than one that shows
  // "⚠ using cached list" with the last-known good entries.
  const historyError = ref<string | null>(null);
  // Opaque cursor the server hands back on every successful call.
  // Tab-scoped — issue #205 calls out cross-tab sharing via
  // localStorage as out of scope.
  let cursor: string | null = null;

  async function fetchSessions(): Promise<SessionSummary[]> {
    const query: Record<string, string> = {};
    if (cursor !== null) query.since = cursor;
    const result = await apiGet<SessionsResponse>(API_ROUTES.sessions.list, query);
    if (!result.ok) {
      historyError.value = result.error;
      // Intentionally preserve `sessions.value` — callers keep showing
      // whatever list was last known to work.
      return sessions.value;
    }
    historyError.value = null;
    const body = result.data;
    if (cursor === null) {
      // First call in this composable instance — server returned the
      // full list; seed the cache directly.
      sessions.value = body.sessions;
    } else {
      sessions.value = applySessionDiff(sessions.value, body.sessions, body.deletedIds);
    }
    cursor = body.cursor;
    return sessions.value;
  }

  return {
    sessions,
    historyError,
    fetchSessions,
  };
}
