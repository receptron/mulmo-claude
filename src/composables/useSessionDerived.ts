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

  // OR of in-memory map (pub/sub-fast) + server summaries (covers un-hydrated sessions). Must stay true across page
  // nav so favicon + FilesView refresh-watcher don't fire before a background run finishes (leaving /chat drops
  // activeSession to undefined).
  const isRunning = computed(() => {
    for (const session of sessionMap.values()) {
      if (session.isRunning) return true;
      if (Object.keys(session.pendingGenerations).length > 0) return true;
    }
    return sessions.value.some((summary) => summary.isRunning);
  });

  // Per-session: a background run in session B must not disable session A's composer or block its auto-scroll.
  const activeSessionRunning = computed(() => {
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
    activeSessionRunning,
    statusMessage,
    toolCallHistory,
    activeSessionCount,
    unreadCount,
  };
}
