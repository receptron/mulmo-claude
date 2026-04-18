// Time-delayed push fan-out scaffold (#144 / #142 stepping stone).
//
// `scheduleTestNotification` takes a message, a delay, and a bridge
// target, then fires a single push to both the Web pub-sub channel
// and the chat-service bridge at the stated time. The goal is a
// minimal proof-of-concept for the production notification pipeline
// the in-app and external-channel notification issues will build on.
//
// **Why this file, not `task-manager`**: task-manager is an interval
// runner today (`schedule: { type: "interval", intervalMs }`). A
// one-shot delay is a different shape, and the first real consumers
// will want cancellable, persisted, per-user scheduling — neither of
// which this scaffold promises. Keeping it separate avoids stretching
// task-manager's API before the real requirements are known.
//
// **No persistence**: `setTimeout` is in-memory. If the server
// restarts before the delay elapses, the push is dropped. Fine for
// a PoC; #144's production scheduler will persist to disk.

import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.js";
import { ONE_SECOND_MS, MAX_NOTIFICATION_DELAY_SEC } from "../utils/time.js";

// Guard against a caller passing an accidentally-huge delay (typo,
// ms-vs-seconds confusion, etc.). 1 hour ceiling is plenty for a
// test ping and still leaves headroom for "fire in 30 minutes".
const DEFAULT_DELAY_SECONDS = 60;
const MAX_DELAY_SECONDS = MAX_NOTIFICATION_DELAY_SEC;

export const DEFAULT_NOTIFICATION_MESSAGE = "Test notification";
export const DEFAULT_NOTIFICATION_TRANSPORT_ID = "cli";
export const DEFAULT_NOTIFICATION_CHAT_ID = "notifications";

export interface NotificationPublishPayload {
  message: string;
  firedAt: string;
}

export interface NotificationDeps {
  /** Emit a payload on a pub/sub channel. Typed as `unknown` to match
   *  the concrete `IPubSub.publish` signature without pulling its
   *  import here. */
  publish: (channel: string, payload: unknown) => void;
  /** Send an async message to a bridge transport (see chat-service
   *  `pushToBridge`). Offline-queued on the chat-service side. */
  pushToBridge: (transportId: string, chatId: string, message: string) => void;
}

export interface ScheduleNotificationOptions {
  message?: string;
  delaySeconds?: number;
  transportId?: string;
  chatId?: string;
}

export interface ScheduledNotification {
  /** Wall-clock ISO8601 when the push will fire. Handy for callers
   *  that want to echo this back to the UI ("fires at 15:03:42"). */
  firesAt: string;
  /** Normalised delay actually used (after default + cap). */
  delaySeconds: number;
  /** Cancel the pending push. No-op if it has already fired. */
  cancel: () => void;
}

export function scheduleTestNotification(
  opts: ScheduleNotificationOptions,
  deps: NotificationDeps,
): ScheduledNotification {
  const message = opts.message ?? DEFAULT_NOTIFICATION_MESSAGE;
  const transportId = opts.transportId ?? DEFAULT_NOTIFICATION_TRANSPORT_ID;
  const chatId = opts.chatId ?? DEFAULT_NOTIFICATION_CHAT_ID;
  const delaySeconds = clampDelay(opts.delaySeconds);
  const delayMs = delaySeconds * ONE_SECOND_MS;

  const firesAt = new Date(Date.now() + delayMs).toISOString();

  const timer = setTimeout(() => {
    const firedAt = new Date().toISOString();
    const payload: NotificationPublishPayload = { message, firedAt };
    deps.publish(PUBSUB_CHANNELS.notifications, payload);
    deps.pushToBridge(transportId, chatId, message);
  }, delayMs);

  return {
    firesAt,
    delaySeconds,
    cancel: () => clearTimeout(timer),
  };
}

function clampDelay(raw: number | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_DELAY_SECONDS;
  }
  if (raw < 0) return 0;
  if (raw > MAX_DELAY_SECONDS) return MAX_DELAY_SECONDS;
  return Math.floor(raw);
}
