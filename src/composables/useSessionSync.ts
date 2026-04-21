// Keep in-memory session state in sync with the server via pub/sub.
// Subscribes to the global `sessions` channel and refetches summaries
// whenever any session's state changes. Also provides markSessionRead
// for clearing the unread flag on the server.

import { onScopeDispose } from "vue";
import type { Ref } from "vue";
import type { ActiveSession, SessionSummary } from "../types/session";
import { usePubSub } from "./usePubSub";
import { PUBSUB_CHANNELS } from "../config/pubsubChannels";
import { apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

export function useSessionSync(opts: {
  sessionMap: Map<string, ActiveSession>;
  currentSessionId: Ref<string>;
  fetchSessions: () => Promise<SessionSummary[]>;
}) {
  const { sessionMap, currentSessionId, fetchSessions } = opts;
  const { subscribe } = usePubSub();

  async function refreshSessionStates(): Promise<void> {
    let summaries: SessionSummary[];
    try {
      summaries = await fetchSessions();
    } catch (err) {
      // Network / HTTP failure — log and bail so the pub/sub
      // callback doesn't produce an unhandled rejection.
      console.warn("[session-sync] failed to fetch sessions:", err);
      return;
    }
    for (const summary of summaries) {
      const live = sessionMap.get(summary.id);
      if (!live) continue;
      live.isRunning = summary.isRunning ?? false;
      live.statusMessage = summary.statusMessage ?? "";
      const unread = summary.hasUnread ?? false;
      if (!(unread && summary.id === currentSessionId.value)) {
        live.hasUnread = unread;
      }
    }
  }

  async function markSessionRead(sessionId: string): Promise<void> {
    const result = await apiPost<{ ok: boolean }>(API_ROUTES.sessions.markRead.replace(":id", encodeURIComponent(sessionId)));
    if (!result.ok || result.data.ok === false) {
      await refreshSessionStates();
    }
  }

  const unsub = subscribe(PUBSUB_CHANNELS.sessions, () => {
    void refreshSessionStates();
  });
  if (typeof unsub === "function") onScopeDispose(unsub);

  return { refreshSessionStates, markSessionRead };
}
