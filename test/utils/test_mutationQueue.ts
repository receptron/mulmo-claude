// Unit tests for the shared mutation queue behind the replace-all client
// stores (`useShortcuts`, `useDashboard`). The serialisation is what stops
// two in-flight PUTs from landing out of order and resurrecting a removed
// entry or dropping a new one. Neither that race nor the cold-load race
// reproduces on demand, so these tests are the only thing holding the
// invariant — an implementation that ran tasks immediately would still
// look correct in manual testing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createMutationQueue } from "../../src/utils/mutationQueue";

const delay = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs));

interface Tracker {
  events: string[];
  peakConcurrency: () => number;
  task: (label: string, delayMs: number) => () => Promise<string>;
}

/** Records start/end of every task plus how many ran at once, so the
 *  tests can assert order AND non-overlap rather than order alone. */
function createTracker(): Tracker {
  const events: string[] = [];
  let active = 0;
  let peak = 0;
  const task = (label: string, delayMs: number) => async (): Promise<string> => {
    active += 1;
    peak = Math.max(peak, active);
    events.push(`start:${label}`);
    await delay(delayMs);
    events.push(`end:${label}`);
    active -= 1;
    return label;
  };
  return { events, peakConcurrency: () => peak, task };
}

describe("createMutationQueue", () => {
  it("runs tasks in submission order and never overlaps them", async () => {
    const tracker = createTracker();
    const { enqueue } = createMutationQueue();

    // Descending delays: run concurrently, the completions would invert.
    const results = await Promise.all([enqueue(tracker.task("a", 30)), enqueue(tracker.task("b", 20)), enqueue(tracker.task("c", 10))]);

    assert.deepEqual(results, ["a", "b", "c"]);
    assert.deepEqual(tracker.events, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
    assert.equal(tracker.peakConcurrency(), 1);
  });

  it("keeps running the task queued behind one that rejects", async () => {
    const order: string[] = [];
    const { enqueue } = createMutationQueue();

    const failing = enqueue(async () => {
      order.push("failing");
      throw new Error("persist failed");
    });
    const next = enqueue(async () => {
      order.push("next");
      return "next-value";
    });

    await assert.rejects(failing, { message: "persist failed" });
    assert.equal(await next, "next-value");
    assert.deepEqual(order, ["failing", "next"]);
  });

  it("propagates the rejection to the failing task's own caller", async () => {
    const { enqueue } = createMutationQueue();
    const boom = new Error("boom");

    await assert.rejects(
      enqueue(async () => {
        throw boom;
      }),
      (err: unknown) => {
        assert.equal(err, boom);
        return true;
      },
    );
  });

  it("treats a synchronous throw inside a task as a rejection and keeps draining", async () => {
    const { enqueue } = createMutationQueue();

    const thrower = enqueue((): Promise<never> => {
      throw new Error("sync boom");
    });
    const survivor = enqueue(async () => "still here");

    await assert.rejects(thrower, { message: "sync boom" });
    assert.equal(await survivor, "still here");
  });

  it("preserves ordering for tasks queued after a rejection", async () => {
    const tracker = createTracker();
    const { enqueue } = createMutationQueue();

    const failing = enqueue(async () => {
      throw new Error("mid-chain failure");
    });
    const rest = Promise.all([enqueue(tracker.task("x", 20)), enqueue(tracker.task("y", 10))]);

    await assert.rejects(failing, { message: "mid-chain failure" });
    assert.deepEqual(await rest, ["x", "y"]);
    assert.deepEqual(tracker.events, ["start:x", "end:x", "start:y", "end:y"]);
    assert.equal(tracker.peakConcurrency(), 1);
  });

  it("runs a task enqueued after the queue has drained", async () => {
    const tracker = createTracker();
    const { enqueue } = createMutationQueue();

    assert.equal(await enqueue(tracker.task("first", 1)), "first");
    assert.equal(await enqueue(tracker.task("second", 1)), "second");

    assert.deepEqual(tracker.events, ["start:first", "end:first", "start:second", "end:second"]);
  });

  it("keeps two queues independent — a blocked one does not hold up the other", async () => {
    const order: string[] = [];
    const shortcutsQueue = createMutationQueue();
    const dashboardQueue = createMutationQueue();

    let releaseBlocked = (): void => {};
    const blocked = new Promise<void>((resolve) => {
      releaseBlocked = resolve;
    });

    const blockedRun = shortcutsQueue.enqueue(async () => {
      order.push("shortcuts:start");
      await blocked;
      order.push("shortcuts:end");
      return "shortcuts";
    });
    const otherRun = dashboardQueue.enqueue(async () => {
      order.push("dashboard");
      return "dashboard";
    });

    assert.equal(await otherRun, "dashboard");
    assert.deepEqual(order, ["shortcuts:start", "dashboard"]);

    releaseBlocked();
    assert.equal(await blockedRun, "shortcuts");
    assert.deepEqual(order, ["shortcuts:start", "dashboard", "shortcuts:end"]);
  });
});
