// #205: send the server's last cursor as ?since=<cursor> so the server replies with a diff. First call has no cursor.

import { getCurrentScope, onScopeDispose, ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { PUBSUB_CHANNELS, readSessionDeletedIds } from "../config/pubsubChannels";
import type { SessionSummary } from "../types/session";
import { apiDelete, apiGet, apiPost } from "../utils/api";
import { applySessionDiff } from "../utils/session/mergeSessions";
import { applyBookmarkFlag } from "./useSessionHistory.helpers";
import { usePubSub } from "./usePubSub";

interface SessionsResponse {
  sessions: SessionSummary[];
  cursor: string;
  deletedIds: string[];
}

// Cross-tab cache pruning: cursor diffs don't carry deletions
// (deletedIds is always [] in the REST response — see #205 comments
// in routes/sessions.ts), so we rely on the channel payload.
//
// Gated on getCurrentScope() so unit tests that instantiate the
// composable outside a Vue setup don't open a real socket.io
// connection (which would keep node's event loop alive and hang
// the test process).
function subscribeToSessionDeletions(sessions: Ref<SessionSummary[]>): void {
  if (!getCurrentScope()) return;
  const { subscribe } = usePubSub();
  const unsubscribe = subscribe(PUBSUB_CHANNELS.sessions, (data) => {
    const ids = readSessionDeletedIds(data);
    if (ids.length === 0) return;
    const drop = new Set(ids);
    sessions.value = sessions.value.filter((session) => !drop.has(session.id));
  });
  if (typeof unsubscribe === "function") onScopeDispose(unsubscribe);
}

function useSessionMutations(sessions: Ref<SessionSummary[]>, historyError: Ref<string | null>) {
  async function setBookmark(sessionId: string, bookmarked: boolean): Promise<boolean> {
    const path = API_ROUTES.sessions.bookmark.replace(":id", encodeURIComponent(sessionId));
    const result = await apiPost<{ ok: boolean }>(path, { bookmarked });
    if (!result.ok) {
      historyError.value = result.error;
      return false;
    }
    // Optimistic local update so the green-icon flip is immediate;
    // the pub/sub round-trip will reaffirm via the cursor diff (meta
    // mtime feeds into changeMs) and also reach other tabs.
    sessions.value = applyBookmarkFlag(sessions.value, sessionId, bookmarked);
    return true;
  }

  async function deleteSession(sessionId: string): Promise<boolean> {
    const path = API_ROUTES.sessions.detail.replace(":id", encodeURIComponent(sessionId));
    const result = await apiDelete<{ ok: boolean }>(path);
    if (!result.ok) {
      historyError.value = result.error;
      return false;
    }
    // Don't update locally — the server publishes `deletedIds` on the
    // sessions channel and the subscriber below removes the row in
    // every tab (including this one) the same way. One code path, no
    // race between the optimistic write and the broadcast.
    return true;
  }

  return { setBookmark, deleteSession };
}

export interface UseSessionHistory {
  sessions: Ref<SessionSummary[]>;
  historyError: Ref<string | null>;
  fetchSessions: () => Promise<SessionSummary[]>;
  setBookmark: (sessionId: string, bookmarked: boolean) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<boolean>;
}

export function useSessionHistory(): UseSessionHistory {
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
    ({ cursor } = body);
    return sessions.value;
  }

  const { setBookmark, deleteSession } = useSessionMutations(sessions, historyError);
  subscribeToSessionDeletions(sessions);

  return {
    sessions,
    historyError,
    fetchSessions,
    setBookmark,
    deleteSession,
  };
}
