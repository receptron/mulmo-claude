// #205: send the server's last cursor as ?since=<cursor> so the server replies with a diff. First call has no cursor.

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
  // Held alongside the stale list, not in place of it — a blank panel on a network blip is worse UX than "⚠ cached".
  const historyError = ref<string | null>(null);
  // Tab-scoped; #205 explicitly leaves cross-tab sharing via localStorage out of scope.
  let cursor: string | null = null;

  async function fetchSessions(): Promise<SessionSummary[]> {
    const query: Record<string, string> = {};
    if (cursor !== null) query.since = cursor;
    const result = await apiGet<SessionsResponse>(API_ROUTES.sessions.list, query);
    if (!result.ok) {
      historyError.value = result.error;
      // Preserve sessions.value so callers keep showing the last-known-good list.
      return sessions.value;
    }
    historyError.value = null;
    const body = result.data;
    if (cursor === null) {
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
