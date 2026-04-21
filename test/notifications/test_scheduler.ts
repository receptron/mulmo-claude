import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOTIFICATION_MESSAGE,
  DEFAULT_NOTIFICATION_CHAT_ID,
  DEFAULT_NOTIFICATION_TRANSPORT_ID,
  scheduleTestNotification,
  initNotifications,
  type NotificationDeps,
} from "../../server/events/notifications.ts";
import type { NotificationPayload } from "../../src/types/notification.ts";
import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.ts";

function isNotificationPayload(value: unknown): value is NotificationPayload {
  if (value === null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.title === "string";
}

interface SpyDeps extends NotificationDeps {
  publishCalls: { channel: string; payload: unknown }[];
  pushCalls: { transportId: string; chatId: string; message: string }[];
}

function createSpyDeps(): SpyDeps {
  const publishCalls: SpyDeps["publishCalls"] = [];
  const pushCalls: SpyDeps["pushCalls"] = [];
  return {
    publishCalls,
    pushCalls,
    publish: (channel, payload) => {
      publishCalls.push({ channel, payload });
    },
    pushToBridge: (transportId, chatId, message) => {
      pushCalls.push({ transportId, chatId, message });
    },
  };
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
});

afterEach(() => {
  mock.timers.reset();
});

describe("scheduleTestNotification — fires once after the delay", () => {
  it("fires publish + push once when the timer elapses", () => {
    const deps = createSpyDeps();
    // Init notification system so publishNotification has deps
    initNotifications(deps);
    const scheduled = scheduleTestNotification({ message: "hello", delaySeconds: 5 }, deps);
    assert.equal(deps.publishCalls.length, 0);
    assert.equal(deps.pushCalls.length, 0);
    mock.timers.tick(4_999);
    assert.equal(deps.publishCalls.length, 0);
    mock.timers.tick(1);
    // publishNotification publishes to the notification channel
    assert.equal(deps.publishCalls.length, 1);
    // Legacy bridge push + no transportId in opts → only bridge push from legacy
    assert.equal(deps.pushCalls.length, 1);
    assert.equal(scheduled.delaySeconds, 5);
    assert.match(scheduled.firesAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("passes the message + channel + bridge identifiers through verbatim", () => {
    const deps = createSpyDeps();
    initNotifications(deps);
    scheduleTestNotification(
      {
        message: "my-msg",
        delaySeconds: 1,
        transportId: "telegram",
        chatId: "chat-42",
      },
      deps,
    );
    mock.timers.tick(1_000);

    assert.equal(deps.publishCalls.length, 1);
    assert.equal(deps.publishCalls[0].channel, PUBSUB_CHANNELS.notifications);
    const payload = deps.publishCalls[0].payload;
    assert.ok(isNotificationPayload(payload));
    assert.equal(payload.title, "my-msg");
    // Legacy bridge push uses custom transport/chat
    assert.deepEqual(deps.pushCalls, [{ transportId: "telegram", chatId: "chat-42", message: "my-msg" }]);
  });

  it("does not fire twice — single setTimeout only", () => {
    const deps = createSpyDeps();
    initNotifications(deps);
    scheduleTestNotification({ delaySeconds: 1 }, deps);
    mock.timers.tick(5_000);
    assert.equal(deps.publishCalls.length, 1);
    assert.equal(deps.pushCalls.length, 1);
  });
});

describe("scheduleTestNotification — defaults", () => {
  it("uses default message / delay / transport / chat when omitted", () => {
    const deps = createSpyDeps();
    initNotifications(deps);
    const scheduled = scheduleTestNotification({}, deps);
    assert.equal(scheduled.delaySeconds, 60);
    mock.timers.tick(60_000);
    assert.equal(deps.publishCalls.length, 1);
    const payload = deps.publishCalls[0].payload;
    assert.ok(isNotificationPayload(payload));
    assert.equal(payload.title, DEFAULT_NOTIFICATION_MESSAGE);
    assert.deepEqual(deps.pushCalls, [
      {
        transportId: DEFAULT_NOTIFICATION_TRANSPORT_ID,
        chatId: DEFAULT_NOTIFICATION_CHAT_ID,
        message: DEFAULT_NOTIFICATION_MESSAGE,
      },
    ]);
  });
});

describe("scheduleTestNotification — delay clamping", () => {
  it("caps delays above the 1-hour ceiling at 3600s", () => {
    const deps = createSpyDeps();
    initNotifications(deps);
    const scheduled = scheduleTestNotification({ delaySeconds: 99999 }, deps);
    assert.equal(scheduled.delaySeconds, 3600);
  });

  it("clamps negative delays to 0 and fires on the next tick", () => {
    const deps = createSpyDeps();
    initNotifications(deps);
    const scheduled = scheduleTestNotification({ delaySeconds: -10 }, deps);
    assert.equal(scheduled.delaySeconds, 0);
    mock.timers.tick(0);
    assert.equal(deps.publishCalls.length, 1);
  });

  it("floors fractional delays (1.9 → 1)", () => {
    const deps = createSpyDeps();
    initNotifications(deps);
    const scheduled = scheduleTestNotification({ delaySeconds: 1.9 }, deps);
    assert.equal(scheduled.delaySeconds, 1);
  });

  it("cancel() prevents the push from firing", () => {
    const deps = createSpyDeps();
    initNotifications(deps);
    const scheduled = scheduleTestNotification({ delaySeconds: 10 }, deps);
    scheduled.cancel();
    mock.timers.tick(20_000);
    assert.equal(deps.publishCalls.length, 0);
    assert.equal(deps.pushCalls.length, 0);
  });
});
