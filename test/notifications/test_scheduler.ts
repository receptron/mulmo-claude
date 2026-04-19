import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOTIFICATION_MESSAGE,
  DEFAULT_NOTIFICATION_CHAT_ID,
  DEFAULT_NOTIFICATION_TRANSPORT_ID,
  scheduleTestNotification,
  type NotificationDeps,
  type NotificationPublishPayload,
} from "../../server/events/notifications.ts";
import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.ts";

// Type guard so tests can narrow an `unknown` payload without an
// `as` cast. Mirrors the shape `scheduleTestNotification` publishes.
function isNotificationPayload(
  value: unknown,
): value is NotificationPublishPayload {
  if (value === null || typeof value !== "object") return false;
  if (!("message" in value) || typeof value.message !== "string") return false;
  if (!("firedAt" in value) || typeof value.firedAt !== "string") return false;
  return true;
}

// Spy-factory for pub-sub + bridge push calls. Tests assert on the
// recorded arrays rather than mocking library internals.
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
    const scheduled = scheduleTestNotification(
      { message: "hello", delaySeconds: 5 },
      deps,
    );
    assert.equal(deps.publishCalls.length, 0);
    assert.equal(deps.pushCalls.length, 0);
    mock.timers.tick(4_999);
    assert.equal(deps.publishCalls.length, 0);
    mock.timers.tick(1);
    assert.equal(deps.publishCalls.length, 1);
    assert.equal(deps.pushCalls.length, 1);
    // Stable `firesAt` returned synchronously matches the delay.
    assert.equal(scheduled.delaySeconds, 5);
    assert.match(
      scheduled.firesAt,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("passes the message + channel + bridge identifiers through verbatim", () => {
    const deps = createSpyDeps();
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
    assert.equal(payload.message, "my-msg");
    assert.match(
      payload.firedAt,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    assert.deepEqual(deps.pushCalls, [
      { transportId: "telegram", chatId: "chat-42", message: "my-msg" },
    ]);
  });

  it("does not fire twice — single setTimeout only", () => {
    const deps = createSpyDeps();
    scheduleTestNotification({ delaySeconds: 1 }, deps);
    mock.timers.tick(5_000);
    assert.equal(deps.publishCalls.length, 1);
    assert.equal(deps.pushCalls.length, 1);
  });
});

describe("scheduleTestNotification — defaults", () => {
  it("uses default message / delay / transport / chat when omitted", () => {
    const deps = createSpyDeps();
    const scheduled = scheduleTestNotification({}, deps);
    assert.equal(scheduled.delaySeconds, 60);
    mock.timers.tick(60_000);
    assert.equal(deps.publishCalls.length, 1);
    const payload = deps.publishCalls[0].payload;
    assert.ok(isNotificationPayload(payload));
    assert.equal(payload.message, DEFAULT_NOTIFICATION_MESSAGE);
    assert.deepEqual(deps.pushCalls, [
      {
        transportId: DEFAULT_NOTIFICATION_TRANSPORT_ID,
        chatId: DEFAULT_NOTIFICATION_CHAT_ID,
        message: DEFAULT_NOTIFICATION_MESSAGE,
      },
    ]);
  });

  it("treats NaN / non-numeric delay as the default 60s", () => {
    const deps = createSpyDeps();
    const s = scheduleTestNotification({ delaySeconds: NaN }, deps);
    assert.equal(s.delaySeconds, 60);
  });
});

describe("scheduleTestNotification — delay clamping", () => {
  it("caps delays above the 1-hour ceiling at 3600s", () => {
    const deps = createSpyDeps();
    const s = scheduleTestNotification({ delaySeconds: 999_999 }, deps);
    assert.equal(s.delaySeconds, 3_600);
    mock.timers.tick(3_600_000);
    assert.equal(deps.publishCalls.length, 1);
  });

  it("clamps negative delays to 0 and fires on the next tick", () => {
    const deps = createSpyDeps();
    const s = scheduleTestNotification({ delaySeconds: -10 }, deps);
    assert.equal(s.delaySeconds, 0);
    mock.timers.tick(0);
    assert.equal(deps.publishCalls.length, 1);
  });

  it("floors fractional delays (1.9 → 1)", () => {
    const deps = createSpyDeps();
    const s = scheduleTestNotification({ delaySeconds: 1.9 }, deps);
    assert.equal(s.delaySeconds, 1);
    mock.timers.tick(1_000);
    assert.equal(deps.publishCalls.length, 1);
  });
});

describe("scheduleTestNotification — cancel", () => {
  it("cancel() before the timer prevents both publish and push", () => {
    const deps = createSpyDeps();
    const scheduled = scheduleTestNotification({ delaySeconds: 10 }, deps);
    scheduled.cancel();
    mock.timers.tick(10_000);
    assert.equal(deps.publishCalls.length, 0);
    assert.equal(deps.pushCalls.length, 0);
  });

  it("cancel() after fire is a no-op (no throw, still single fire)", () => {
    const deps = createSpyDeps();
    const scheduled = scheduleTestNotification({ delaySeconds: 1 }, deps);
    mock.timers.tick(1_000);
    assert.equal(deps.publishCalls.length, 1);
    scheduled.cancel(); // must not throw
    mock.timers.tick(1_000);
    assert.equal(deps.publishCalls.length, 1);
  });
});
