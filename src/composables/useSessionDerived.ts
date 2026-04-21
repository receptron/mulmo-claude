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

  // The server-side summary already merges pendingGenerations into
  // `isRunning` (see server/api/routes/sessions.ts), but pub/sub events
  // for background generations arrive faster than the next sessions
  // refetch — fold the in-memory map in so ChatInput reflects the new
  // state immediately.
  const isRunning = computed(() => {
    const active = activeSession.value;
    const pending = active ? Object.keys(active.pendingGenerations).length > 0 : false;
    return currentSummary.value?.isRunning || active?.isRunning || pending || false;
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
