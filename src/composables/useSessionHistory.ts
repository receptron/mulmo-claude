// Composable for the session-history dropdown in the header.
//
// Owns the `sessions` list (what the server knows about) and the
// `showHistory` open/closed flag, plus the fetch + toggle helpers.
// The dropdown lazy-loads the list only when opened, and callers
// can invoke `fetchSessions()` directly after an end-of-run so the
// sidebar title cache stays fresh.
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
  showHistory: Ref<boolean>;
  historyError: Ref<string | null>;
  fetchSessions: () => Promise<SessionSummary[]>;
  toggleHistory: () => Promise<void>;
} {
  const sessions = ref<SessionSummary[]>([]);
  const showHistory = ref(false);
  // Surfaces the most recent fetch failure. Kept alongside the (stale)
  // sessions list rather than wiping it — a dropdown that goes blank
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

  async function toggleHistory(): Promise<void> {
    showHistory.value = !showHistory.value;
    if (showHistory.value) await fetchSessions();
  }

  return {
    sessions,
    showHistory,
    historyError,
    fetchSessions,
    toggleHistory,
  };
}
