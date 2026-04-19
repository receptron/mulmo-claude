// Single source of truth for every WebSocket pub/sub channel name
// the app publishes to or subscribes to. Keeping these in one file
// means:
//
//   - a rename is one edit instead of a grep-and-edit across
//     server + client
//   - typo-wise, publisher and subscriber can't drift (both import
//     the same const / factory)
//   - a new channel gets declared here first, then wired — the
//     declaration serves as a lightweight registry / audit list
//
// First slice of issue #289 (item 6: pub-sub channels).

/**
 * Channel for the per-session event stream. One per chat session.
 * Publishers: `server/session-store/index.ts` (tool results, status,
 * text chunks, switch-role, session_finished, …).
 * Subscribers: `src/App.vue` (one subscription per actively-viewed
 * session).
 */
export function sessionChannel(chatSessionId: string): string {
  return `session.${chatSessionId}`;
}

/** Static pub/sub channel names. Factories for parameterised channels
 *  (e.g. `sessionChannel(id)`) live alongside as named helpers. */
export const PUBSUB_CHANNELS = {
  /** Sidebar "a session updated, please refetch" notification.
   *  Publisher: `server/session-store/index.ts#notifySessionsChanged`.
   *  Subscriber: `src/App.vue`. */
  sessions: "sessions",
  /** Server-side debug heartbeat — wired through the task-manager
   *  demo counter. Useful for sanity-checking that the WS pipe is
   *  alive end-to-end. */
  debugBeat: "debug.beat",
  /** Broadcast push notifications to every open Web tab (scaffold for
   *  the in-app notification center #144). The test endpoint
   *  `POST /api/notifications/test` publishes here; the production
   *  triggers (scheduler / todo reminders / journal) will follow
   *  the same channel. Subscriber list starts empty — the UI lands
   *  in a separate PR. Payload: `{ message: string, firedAt: ISO8601 }`. */
  notifications: "notifications",
} as const;

export type StaticPubSubChannel =
  (typeof PUBSUB_CHANNELS)[keyof typeof PUBSUB_CHANNELS];
