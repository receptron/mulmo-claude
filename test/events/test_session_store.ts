import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __resetForTests,
  getSession,
  getOrCreateSession,
  beginRun,
  endRun,
  cancelRun,
  markRead,
  getActiveSessionIds,
  getSessionImageData,
  initSessionStore,
  pushSessionEvent,
} from "../../server/events/session-store/index.ts";
import { EVENT_TYPES, GENERATION_KINDS, generationKey } from "../../src/types/events.ts";

const NOW = "2026-04-17T00:00:00.000Z";

function sessionOpts(overrides: Partial<Parameters<typeof getOrCreateSession>[1]> = {}) {
  return {
    roleId: "general",
    resultsFilePath: "/tmp/fake.jsonl",
    startedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// Stub pubsub — just tracks published channels.
function stubPubSub() {
  const published: { channel: string; data: unknown }[] = [];
  return {
    published,
    publish(channel: string, data: unknown) {
      published.push({ channel, data });
    },
  };
}

beforeEach(() => {
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
});

describe("getSession / getOrCreateSession", () => {
  it("returns undefined for a non-existent session", () => {
    assert.equal(getSession("nope"), undefined);
  });

  it("creates a session on first call and returns it on subsequent calls", () => {
    const session = getOrCreateSession("s1", sessionOpts());
    assert.equal(session.chatSessionId, "s1");
    assert.equal(session.roleId, "general");
    assert.equal(session.isRunning, false);
    assert.equal(session.hasUnread, false);

    const sessionB = getOrCreateSession("s1", sessionOpts({ roleId: "coder" }));
    assert.strictEqual(session, sessionB); // same object
    assert.equal(sessionB.roleId, "general"); // not overwritten
  });

  it("updates selectedImageData and updatedAt on re-access", () => {
    getOrCreateSession("s1", sessionOpts());
    const updated = getOrCreateSession(
      "s1",
      sessionOpts({
        selectedImageData: "base64...",
        updatedAt: "2026-04-17T01:00:00Z",
      }),
    );
    assert.equal(updated.selectedImageData, "base64...");
    assert.equal(updated.updatedAt, "2026-04-17T01:00:00Z");
  });

  it("honours hasUnread option on creation", () => {
    const sess = getOrCreateSession("s1", sessionOpts({ hasUnread: true }));
    assert.equal(sess.hasUnread, true);
  });
});

describe("beginRun / endRun / cancelRun", () => {
  it("beginRun sets isRunning=true and returns true", () => {
    getOrCreateSession("s1", sessionOpts());
    const abort = () => {};
    assert.equal(beginRun("s1", abort), true);
    assert.equal(getSession("s1")?.isRunning, true);
  });

  it("beginRun rejects when session is already running (409 guard)", () => {
    getOrCreateSession("s1", sessionOpts());
    beginRun("s1", () => {});
    assert.equal(
      beginRun("s1", () => {}),
      false,
    );
  });

  it("beginRun returns false for unknown session", () => {
    assert.equal(
      beginRun("nope", () => {}),
      false,
    );
  });

  it("endRun sets isRunning=false and hasUnread=true", () => {
    getOrCreateSession("s1", sessionOpts());
    beginRun("s1", () => {});
    // initSessionStore is needed for endRun to publish
    initSessionStore(stubPubSub());
    endRun("s1");
    const sess = getSession("s1");
    assert.ok(sess);
    assert.equal(sess.isRunning, false);
    assert.equal(sess.hasUnread, true);
  });

  it("cancelRun invokes the abort callback and returns true", () => {
    getOrCreateSession("s1", sessionOpts());
    let aborted = false;
    beginRun("s1", () => {
      aborted = true;
    });
    assert.equal(cancelRun("s1"), true);
    assert.equal(aborted, true);
  });

  it("cancelRun returns false when not running", () => {
    getOrCreateSession("s1", sessionOpts());
    assert.equal(cancelRun("s1"), false);
  });

  it("cancelRun returns false for unknown session", () => {
    assert.equal(cancelRun("nope"), false);
  });
});

describe("markRead", () => {
  it("clears hasUnread on an in-memory session", async () => {
    initSessionStore(stubPubSub());
    const sess = getOrCreateSession("s1", sessionOpts({ hasUnread: true }));
    assert.equal(sess.hasUnread, true);
    await markRead("s1");
    assert.equal(sess.hasUnread, false);
  });

  it("is a no-op when hasUnread is already false (no redundant work)", async () => {
    const pubSub = stubPubSub();
    initSessionStore(pubSub);
    getOrCreateSession("s1", sessionOpts({ hasUnread: false }));
    await markRead("s1");
    // No sessions-changed notification should fire for a no-op
    const sessionChanges = pubSub.published.filter((pub) => pub.channel === "sessions");
    assert.equal(sessionChanges.length, 0);
  });

  it("publishes a sessions-changed notification when clearing the flag", async () => {
    const pubSub = stubPubSub();
    initSessionStore(pubSub);
    getOrCreateSession("s1", sessionOpts({ hasUnread: true }));
    await markRead("s1");
    const sessionChanges = pubSub.published.filter((pub) => pub.channel === "sessions");
    assert.ok(sessionChanges.length > 0);
  });

  it("does not throw for an unknown session (disk-only fallback)", async () => {
    initSessionStore(stubPubSub());
    // No session created — should not throw
    await markRead("nonexistent");
  });
});

describe("getActiveSessionIds", () => {
  it("returns only running sessions", () => {
    getOrCreateSession("s1", sessionOpts());
    getOrCreateSession("s2", sessionOpts());
    beginRun("s1", () => {});
    const active = getActiveSessionIds();
    assert.equal(active.size, 1);
    assert.ok(active.has("s1"));
    assert.ok(!active.has("s2"));
  });

  it("returns empty set when nothing is running", () => {
    getOrCreateSession("s1", sessionOpts());
    assert.equal(getActiveSessionIds().size, 0);
  });
});

describe("getSessionImageData", () => {
  it("returns the selectedImageData for an existing session", () => {
    getOrCreateSession("s1", sessionOpts({ selectedImageData: "img" }));
    assert.equal(getSessionImageData("s1"), "img");
  });

  it("returns undefined for unknown session", () => {
    assert.equal(getSessionImageData("nope"), undefined);
  });
});

describe("pushSessionEvent — pendingGenerations lifecycle", () => {
  // Pin the start → finish round-trip so the in-store pending map
  // both gains and loses the entry. Prior to the no-dynamic-delete
  // fix the finish path used `delete obj[key]`; this test guards
  // against a future regression of the equivalent
  // `Reflect.deleteProperty` call.
  beforeEach(() => {
    initSessionStore(stubPubSub());
  });

  function makeGenerationEvent(type: string) {
    return { type, kind: GENERATION_KINDS.beatImage, filePath: "/tmp/foo.png", key: "k1" };
  }

  it("adds a pendingGenerations entry on generationStarted", () => {
    getOrCreateSession("s1", sessionOpts());
    pushSessionEvent("s1", makeGenerationEvent(EVENT_TYPES.generationStarted));
    const pending = getSession("s1")?.pendingGenerations ?? {};
    const expectedKey = generationKey(GENERATION_KINDS.beatImage, "/tmp/foo.png", "k1");
    assert.ok(expectedKey in pending, "key should be present after start");
  });

  it("removes the entry on generationFinished (no leftover key)", () => {
    getOrCreateSession("s1", sessionOpts());
    pushSessionEvent("s1", makeGenerationEvent(EVENT_TYPES.generationStarted));
    pushSessionEvent("s1", makeGenerationEvent(EVENT_TYPES.generationFinished));
    const pending = getSession("s1")?.pendingGenerations ?? {};
    const expectedKey = generationKey(GENERATION_KINDS.beatImage, "/tmp/foo.png", "k1");
    assert.equal(expectedKey in pending, false, "key should be gone after finish");
    assert.equal(Object.keys(pending).length, 0, "no leftover keys");
  });
});
