// Keep in-memory session state in sync with the server via pub/sub.
// Subscribes to the global `sessions` channel and refetches summaries
// whenever any session's state changes. Also provides markSessionRead
// for clearing the unread flag on the server.

import { onScopeDispose } from "vue";
import type { Ref } from "vue";
import type { ActiveSession, SessionSummary } from "../types/session";
import { usePubSub } from "./usePubSub";
import { PUBSUB_CHANNELS, type SessionsChannelPayload } from "../config/pubsubChannels";
import { apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

function readDeletedIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const ids = (payload as SessionsChannelPayload).deletedIds;
  return Array.isArray(ids) ? ids.filter((entry): entry is string => typeof entry === "string") : [];
}

export function useSessionSync(opts: {
  sessionMap: Map<string, ActiveSession>;
  currentSessionId: Ref<string>;
  fetchSessions: () => Promise<SessionSummary[]>;
  /** Called when the session the user is currently viewing has been
   *  hard-deleted (typically from another tab). The host owns the
   *  recovery action — usually navigate to a fresh session so the
   *  blank chat view doesn't linger on a dead URL. */
  onCurrentSessionDeleted?: () => void;
}) {
  const { sessionMap, currentSessionId, fetchSessions, onCurrentSessionDeleted } = opts;
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

  const unsub = subscribe(PUBSUB_CHANNELS.sessions, (data) => {
    // Hard-deleted sessions need to leave sessionMap immediately —
    // refreshSessionStates only updates entries it still finds in the
    // server response, so a deleted live session would otherwise
    // linger in mergedSessions until the tab reloads.
    const deletedIds = readDeletedIds(data);
    let currentWasDeleted = false;
    for (const deletedId of deletedIds) {
      sessionMap.delete(deletedId);
      if (deletedId === currentSessionId.value) currentWasDeleted = true;
    }
    if (currentWasDeleted) onCurrentSessionDeleted?.();
    void refreshSessionStates();
  });
  if (typeof unsub === "function") onScopeDispose(unsub);

  return { refreshSessionStates, markSessionRead };
}
