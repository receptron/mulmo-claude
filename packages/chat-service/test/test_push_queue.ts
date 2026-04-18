import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPushQueue, type PushQueue } from "../src/push-queue.js";

const msg = (chatId: string, message: string) => ({
  chatId,
  message,
  enqueuedAt: 0,
});

describe("createPushQueue", () => {
  let q: PushQueue;

  beforeEach(() => {
    q = createPushQueue();
  });

  it("starts empty for any transport", () => {
    assert.equal(q.sizeFor("cli"), 0);
    assert.deepEqual(q.drainFor("cli"), []);
  });

  it("enqueue + drain returns the message", () => {
    q.enqueue("cli", msg("terminal", "hello"));
    assert.equal(q.sizeFor("cli"), 1);
    const drained = q.drainFor("cli");
    assert.equal(drained.length, 1);
    assert.equal(drained[0].chatId, "terminal");
    assert.equal(drained[0].message, "hello");
  });

  it("preserves FIFO order", () => {
    q.enqueue("cli", msg("a", "1"));
    q.enqueue("cli", msg("b", "2"));
    q.enqueue("cli", msg("c", "3"));
    const drained = q.drainFor("cli");
    assert.deepEqual(
      drained.map((m) => m.message),
      ["1", "2", "3"],
    );
  });

  it("drainFor empties the queue", () => {
    q.enqueue("cli", msg("x", "y"));
    q.drainFor("cli");
    assert.equal(q.sizeFor("cli"), 0);
    assert.deepEqual(q.drainFor("cli"), []);
  });

  it("keeps per-transport queues isolated", () => {
    q.enqueue("cli", msg("a", "cli-msg"));
    q.enqueue("telegram", msg("b", "tg-msg"));
    assert.equal(q.sizeFor("cli"), 1);
    assert.equal(q.sizeFor("telegram"), 1);

    const cliDrain = q.drainFor("cli");
    assert.equal(cliDrain[0].message, "cli-msg");
    assert.equal(q.sizeFor("cli"), 0);
    assert.equal(q.sizeFor("telegram"), 1);
  });

  it("drainFor on an unknown transport is a no-op", () => {
    assert.deepEqual(q.drainFor("nonexistent"), []);
    assert.equal(q.sizeFor("nonexistent"), 0);
  });
});
