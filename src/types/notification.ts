// Notification payload — shared by server (publish) and frontend (subscribe).

export const NOTIFICATION_KINDS = {
  todo: "todo",
  scheduler: "scheduler",
  agent: "agent",
  journal: "journal",
  push: "push",
  bridge: "bridge",
} as const;

export type NotificationKind =
  (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

export const NOTIFICATION_ICONS: Record<NotificationKind, string> = {
  todo: "check_circle",
  scheduler: "event",
  agent: "smart_toy",
  journal: "auto_stories",
  push: "notifications",
  bridge: "chat",
};

export const NOTIFICATION_ACTION_TYPES = {
  navigate: "navigate",
  none: "none",
} as const;

export type NotificationActionType =
  (typeof NOTIFICATION_ACTION_TYPES)[keyof typeof NOTIFICATION_ACTION_TYPES];

export const NOTIFICATION_VIEWS = {
  todos: "todos",
  scheduler: "scheduler",
  files: "files",
  chat: "chat",
} as const;

export type NotificationView =
  (typeof NOTIFICATION_VIEWS)[keyof typeof NOTIFICATION_VIEWS];

export const NOTIFICATION_PRIORITIES = {
  normal: "normal",
  high: "high",
} as const;

export type NotificationPriority =
  (typeof NOTIFICATION_PRIORITIES)[keyof typeof NOTIFICATION_PRIORITIES];

export type NotificationAction =
  | {
      type: typeof NOTIFICATION_ACTION_TYPES.navigate;
      view: NotificationView;
      path?: string;
      sessionId?: string;
      itemId?: string;
    }
  | { type: typeof NOTIFICATION_ACTION_TYPES.none };

export interface NotificationPayload {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  icon?: string;
  action: NotificationAction;
  firedAt: string;
  priority: NotificationPriority;
  sessionId?: string;
  transportId?: string;
}
