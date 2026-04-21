// Pure mapping from NotificationAction → target view/session to navigate to.

import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_VIEWS, type NotificationAction } from "../../types/notification";

// Views that map directly to a canvas view mode (excludes "chat"
// which is handled as a session navigation).
type CanvasNotificationView = "todos" | "scheduler" | "files";

export type NotificationTarget = { kind: "session"; sessionId: string } | { kind: "view"; view: CanvasNotificationView } | null;

/** Determine what the user should see after clicking a notification.
 *  Pure — the caller performs the actual navigation. */
export function resolveNotificationTarget(action: NotificationAction): NotificationTarget {
  if (action.type !== NOTIFICATION_ACTION_TYPES.navigate) return null;
  if (action.view === NOTIFICATION_VIEWS.chat && action.sessionId) {
    return { kind: "session", sessionId: action.sessionId };
  }
  if (action.view === NOTIFICATION_VIEWS.todos || action.view === NOTIFICATION_VIEWS.scheduler || action.view === NOTIFICATION_VIEWS.files) {
    return { kind: "view", view: action.view };
  }
  return null;
}
