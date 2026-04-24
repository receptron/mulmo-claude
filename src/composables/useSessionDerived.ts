// Computed properties derived from sessionMap + sessions list.
// Extracted from App.vue to reduce the component's reactive surface.

import { computed, type Ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ActiveSession, SessionSummary } from "../types/session";
import type { ToolCallHistoryItem } from "../types/toolCallHistory";
import { deduplicateResults } from "../utils/tools/dedup";

export function useSessionDerived(opts: { sessionMap: Map<string, ActiveSession>; currentSessionId: Ref<string>; sessions: Ref<SessionSummary[]> }) {
  const { sessionMap, currentSessionId, sessions } = opts;

  const activeSession = computed(() => sessionMap.get(currentSessionId.value));

  const toolResults = computed<ToolResultComplete[]>(() => activeSession.value?.toolResults ?? []);

  const sidebarResults = computed(() => deduplicateResults(toolResults.value));

  const currentSummary = computed(() => sessions.value.find((summary) => summary.id === currentSessionId.value));

  // Global "is anything running" across every known session — in-memory
  // map (which reflects pub/sub events faster than server refetch) and
  // server-side summaries (for sessions not yet hydrated into the map).
  // Scoping this to `activeSession` would drop to false as soon as the
  // user leaves /chat (activeSession → undefined), firing downstream
  // `watch(isRunning)` consumers before background runs actually
  // finish — e.g. FilesView would refresh too early and miss writes.
  const isRunning = computed(() => {
    for (const session of sessionMap.values()) {
      if (session.isRunning) return true;
      if (Object.keys(session.pendingGenerations).length > 0) return true;
    }
    return sessions.value.some((summary) => summary.isRunning);
  });

  const statusMessage = computed(() => currentSummary.value?.statusMessage ?? activeSession.value?.statusMessage ?? "");

  const toolCallHistory = computed<ToolCallHistoryItem[]>(() => activeSession.value?.toolCallHistory ?? []);

  const activeSessionCount = computed(() => sessions.value.filter((session) => session.isRunning).length);

  const unreadCount = computed(() => sessions.value.filter((session) => session.hasUnread).length);

  return {
    activeSession,
    toolResults,
    sidebarResults,
    currentSummary,
    isRunning,
    statusMessage,
    toolCallHistory,
    activeSessionCount,
    unreadCount,
  };
}
