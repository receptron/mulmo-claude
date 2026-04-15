// Composable for the session-history dropdown in the header.
//
// Owns the `sessions` list (what the server knows about) and the
// `showHistory` open/closed flag, plus the fetch + toggle helpers.
// The dropdown lazy-loads the list only when opened, and callers
// can invoke `fetchSessions()` directly after an end-of-run so the
// sidebar title cache stays fresh.

import { ref, type Ref } from "vue";
import type { SessionSummary } from "../types/session";
import { apiGet } from "../utils/api";

export function useSessionHistory(): {
  sessions: Ref<SessionSummary[]>;
  showHistory: Ref<boolean>;
  fetchSessions: () => Promise<SessionSummary[]>;
  toggleHistory: () => Promise<void>;
} {
  const sessions = ref<SessionSummary[]>([]);
  const showHistory = ref(false);

  async function fetchSessions(): Promise<SessionSummary[]> {
    const result = await apiGet<SessionSummary[]>("/api/sessions");
    if (!result.ok) {
      sessions.value = [];
      return [];
    }
    sessions.value = result.data;
    return result.data;
  }

  async function toggleHistory(): Promise<void> {
    showHistory.value = !showHistory.value;
    if (showHistory.value) await fetchSessions();
  }

  return { sessions, showHistory, fetchSessions, toggleHistory };
}
