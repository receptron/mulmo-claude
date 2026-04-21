// Notification system (#144).
//
// Publishes NotificationPayload to:
//   1. Web pub-sub → bell badge + panel
//   2. Chat-service bridge → Telegram / CLI
//
// Callers (trigger sources) use `publishNotification()` to fire.
// In-memory store keeps the last N notifications for the bell panel.
// publishNotification() is wrapped in try-catch so failures never
// propagate to callers (e.g. endRun in session-store).

import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.js";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_ICONS,
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_PRIORITIES,
  type NotificationPayload,
  type NotificationKind,
  type NotificationAction,
  type NotificationPriority,
} from "../../src/types/notification.js";
import { MAX_NOTIFICATION_DELAY_SEC } from "../utils/time.js";
import { log } from "../system/logger/index.js";

// ── Dependencies (injected at startup) ──────────────────────────

export interface NotificationDeps {
  publish: (channel: string, payload: unknown) => void;
  pushToBridge: (transportId: string, chatId: string, message: string) => void;
}

let deps: NotificationDeps | null = null;

export function initNotifications(injected: NotificationDeps): void {
  deps = injected;
}

// ── In-memory store ─────────────────────────────────────────────

const MAX_STORED = 50;
const store: NotificationPayload[] = [];

export function getRecentNotifications(): readonly NotificationPayload[] {
  return store;
}

// ── Publish ─────────────────────────────────────────────────────

export interface PublishNotificationOpts {
  kind: NotificationKind;
  title: string;
  body?: string;
  action?: NotificationAction;
  priority?: NotificationPriority;
  sessionId?: string;
  transportId?: string;
}

export function publishNotification(opts: PublishNotificationOpts): void {
  try {
    const payload: NotificationPayload = {
      id: crypto.randomUUID(),
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      icon: NOTIFICATION_ICONS[opts.kind],
      action: opts.action ?? { type: NOTIFICATION_ACTION_TYPES.none },
      firedAt: new Date().toISOString(),
      priority: opts.priority ?? NOTIFICATION_PRIORITIES.normal,
      sessionId: opts.sessionId,
      transportId: opts.transportId,
    };

    // Store for bell panel
    store.unshift(payload);
    if (store.length > MAX_STORED) store.length = MAX_STORED;

    // Push to Web UI via pub-sub
    if (deps) {
      deps.publish(PUBSUB_CHANNELS.notifications, payload);
    }

    // Push to bridge (Telegram/CLI)
    if (deps && opts.transportId) {
      deps.pushToBridge(opts.transportId, "notifications", formatBridgeMessage(payload));
    }

    log.info("notifications", "published", {
      kind: payload.kind,
      title: payload.title,
      id: payload.id,
    });
  } catch (err) {
    // Never let notification failures break the caller (e.g. endRun).
    log.warn("notifications", "publish failed", { error: String(err) });
  }
}

function formatBridgeMessage(payload: NotificationPayload): string {
  const icon = payload.kind === NOTIFICATION_KINDS.agent ? "\u2705" : "\u{1F514}";
  const parts = [icon, payload.title];
  if (payload.body) parts.push(payload.body);
  return parts.join(" ");
}

// ── Legacy test notification (kept for PoC endpoint) ────────────

export const DEFAULT_NOTIFICATION_MESSAGE = "Test notification";
export const DEFAULT_NOTIFICATION_TRANSPORT_ID = "cli";
export const DEFAULT_NOTIFICATION_CHAT_ID = "notifications";

export interface ScheduleNotificationOptions {
  message?: string;
  delaySeconds?: number;
  transportId?: string;
  chatId?: string;
}

export interface ScheduledNotification {
  firesAt: string;
  delaySeconds: number;
  cancel: () => void;
}

export function scheduleTestNotification(opts: ScheduleNotificationOptions, legacyDeps: NotificationDeps): ScheduledNotification {
  const message = opts.message ?? DEFAULT_NOTIFICATION_MESSAGE;
  const transportId = opts.transportId ?? DEFAULT_NOTIFICATION_TRANSPORT_ID;
  const chatId = opts.chatId ?? DEFAULT_NOTIFICATION_CHAT_ID;
  const delaySeconds = clampDelay(opts.delaySeconds);
  const delayMs = delaySeconds * 1_000;

  const firesAt = new Date(Date.now() + delayMs).toISOString();

  const timer = setTimeout(() => {
    publishNotification({
      kind: NOTIFICATION_KINDS.push,
      title: message,
      priority: NOTIFICATION_PRIORITIES.normal,
    });
    legacyDeps.pushToBridge(transportId, chatId, message);
  }, delayMs);

  return {
    firesAt,
    delaySeconds,
    cancel: () => clearTimeout(timer),
  };
}

const DEFAULT_DELAY_SECONDS = 60;

function clampDelay(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_DELAY_SECONDS;
  }
  if (raw < 0) return 0;
  if (raw > MAX_NOTIFICATION_DELAY_SEC) return MAX_NOTIFICATION_DELAY_SEC;
  return Math.floor(raw);
}
