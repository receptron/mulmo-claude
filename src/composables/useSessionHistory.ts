// Composable for the session-history dropdown in the header.
//
// Owns the `sessions` list (what the server knows about) and the
// `showHistory` open/closed flag, plus the fetch + toggle helpers.
// The dropdown lazy-loads the list only when opened, and callers
// can invoke `fetchSessions()` directly after an end-of-run so the
// sidebar title cache stays fresh.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import type { SessionSummary } from "../types/session";
import { apiGet } from "../utils/api";

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

  async function fetchSessions(): Promise<SessionSummary[]> {
    const result = await apiGet<SessionSummary[]>(API_ROUTES.sessions.list);
    if (!result.ok) {
      historyError.value = result.error;
      // Intentionally preserve `sessions.value` — callers keep showing
      // whatever list was last known to work.
      return sessions.value;
    }
    historyError.value = null;
    sessions.value = result.data;
    return result.data;
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
