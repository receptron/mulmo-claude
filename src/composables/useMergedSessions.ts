// Merged session list for the history pane + tab bar.
// Live sessions in sessionMap are merged with server-only sessions
// (from the chat indexer), sorted newest-first by updatedAt.

import { computed, type Ref } from "vue";
import type { ActiveSession, SessionSummary } from "../types/session";
import { mergeSessionLists } from "../utils/session/mergeSessions";

const MAX_TABS = 6;

export function useMergedSessions(opts: { sessionMap: Map<string, ActiveSession>; sessions: Ref<SessionSummary[]> }) {
  const { sessionMap, sessions } = opts;

  const mergedSessions = computed((): SessionSummary[] => mergeSessionLists([...sessionMap.values()], sessions.value));

  const tabSessions = computed(() => mergedSessions.value.slice(0, MAX_TABS));

  return { mergedSessions, tabSessions };
}
