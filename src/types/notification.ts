// Notification payload — shared by server (publish) and frontend (subscribe).
//
// The discriminator hierarchy is:
//   NotificationPayload.action.type       — "navigate" | "none"
//   NotificationPayload.action.target.view — which feature page
// Each `target.view` variant carries the typed identifier(s) needed
// to deep-link the user to a specific item on that page (todoId,
// taskId, slug, …). Missing identifier fields are fine — the
// dispatcher falls back to the feature's index view, which matches
// the pre-permalink behaviour.

export const NOTIFICATION_KINDS = {
  todo: "todo",
  scheduler: "scheduler",
  agent: "agent",
  journal: "journal",
  push: "push",
  bridge: "bridge",
} as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

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

export type NotificationActionType = (typeof NOTIFICATION_ACTION_TYPES)[keyof typeof NOTIFICATION_ACTION_TYPES];

// Views a notification can target. Kept in sync with `PAGE_ROUTES`
// in src/router/index.ts — Calendar and Automations are peer pages
// after the #758 split; Automations is where scheduled tasks live.
export const NOTIFICATION_VIEWS = {
  chat: "chat",
  todos: "todos",
  calendar: "calendar",
  automations: "automations",
  sources: "sources",
  files: "files",
  wiki: "wiki",
} as const;

export type NotificationView = (typeof NOTIFICATION_VIEWS)[keyof typeof NOTIFICATION_VIEWS];

export const NOTIFICATION_PRIORITIES = {
  normal: "normal",
  high: "high",
} as const;

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[keyof typeof NOTIFICATION_PRIORITIES];

// Deep-link target per feature page. Every variant identifies which
// page the notification refers to, plus any optional identifier the
// router / page component needs to jump to a specific item. Omitting
// the identifier lands on the feature's index view.
export type NotificationTarget =
  | { view: typeof NOTIFICATION_VIEWS.chat; sessionId: string; resultUuid?: string }
  | { view: typeof NOTIFICATION_VIEWS.todos; itemId?: string }
  | { view: typeof NOTIFICATION_VIEWS.calendar }
  | { view: typeof NOTIFICATION_VIEWS.automations; taskId?: string }
  | { view: typeof NOTIFICATION_VIEWS.sources; slug?: string }
  | { view: typeof NOTIFICATION_VIEWS.files; path?: string }
  | { view: typeof NOTIFICATION_VIEWS.wiki; slug?: string; anchor?: string };

export type NotificationAction =
  | {
      type: typeof NOTIFICATION_ACTION_TYPES.navigate;
      target: NotificationTarget;
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
