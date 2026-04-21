import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HostRateLimiter, DEFAULT_MIN_DELAY_MS, type RateLimiterDeps } from "../../server/workspace/sources/rateLimiter.js";

// Controllable clock + sleep for deterministic tests. Returns a
// deps object plus direct state access so tests can advance time
// without real timers.
function controllableClock(start = 0): {
  deps: RateLimiterDeps;
  tick: (ms: number) => void;
  read: () => number;
} {
  const state = { t: start };
  return {
    deps: {
      now: () => state.t,
      sleep: (ms) => {
        state.t += ms;
        return Promise.resolve();
      },
    },
    tick: (ms) => {
      state.t += ms;
    },
    read: () => state.t,
  };
}

describe("HostRateLimiter — basic behaviour", () => {
  it("runs a single task and returns its value", async () => {
    const { deps } = controllableClock();
    const lim = new HostRateLimiter(deps);
    const result = await lim.run("example.com", async () => 42);
    assert.equal(result, 42);
  });

  it("propagates task errors without poisoning the queue", async () => {
    const { deps } = controllableClock();
    const lim = new HostRateLimiter(deps);
    await assert.rejects(
      () =>
        lim.run("example.com", async () => {
          throw new Error("boom");
        }),
      /boom/,
    );
    // Second call on the same host still runs.
    const result = await lim.run("example.com", async () => "ok");
    assert.equal(result, "ok");
  });

  it("tracks host count as new hosts are used", async () => {
    const { deps } = controllableClock();
    const lim = new HostRateLimiter(deps);
    assert.equal(lim.hostCount(), 0);
    await lim.run("a.com", async () => "a");
    await lim.run("b.com", async () => "b");
    await lim.run("a.com", async () => "a2");
    assert.equal(lim.hostCount(), 2);
  });
});

describe("HostRateLimiter — serialization per host", () => {
  it("serializes concurrent calls to the same host", async () => {
    const { deps } = controllableClock();
    const lim = new HostRateLimiter(deps);
    // The semaphore-like invariant: if two run() calls are issued
    // back-to-back on the same host, the second task must not
    // start until the first has completed.
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const first = lim.run(
      "example.com",
      async () => {
        events.push("first:start");
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        events.push("first:end");
        return 1;
      },
      0,
    );
    const second = lim.run(
      "example.com",
      async () => {
        events.push("second:start");
        return 2;
      },
      0,
    );
    // Let first's body start. It's now awaiting releaseFirst.
    await Promise.resolve();
    await Promise.resolve();
    // Second hasn't started yet.
    assert.deepEqual(events, ["first:start"]);
    releaseFirst();
    const [resA, resB] = await Promise.all([first, second]);
    assert.equal(resA, 1);
    assert.equal(resB, 2);
    assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
  });

  it("allows different hosts to run concurrently", async () => {
    const { deps } = controllableClock();
    const lim = new HostRateLimiter(deps);
    const events: string[] = [];
    let releaseA: () => void = () => {};
    const runA = lim.run(
      "a.com",
      async () => {
        events.push("a:start");
        await new Promise<void>((resolve) => {
          releaseA = resolve;
        });
        events.push("a:end");
        return "a";
      },
      0,
    );
    const runB = lim.run(
      "b.com",
      async () => {
        events.push("b:start");
        return "b";
      },
      0,
    );
    // Let both tasks schedule. a is still awaiting; b should
    // have completed.
    const bResult = await runB;
    assert.equal(bResult, "b");
    // b:start must have happened BEFORE a finishes — distinct
    // hosts don't serialize.
    assert.deepEqual(events, ["a:start", "b:start"]);
    releaseA();
    await runA;
  });
});

describe("HostRateLimiter — minimum delay enforcement", () => {
  it("honours minDelayMs between consecutive same-host calls", async () => {
    const clock = controllableClock(0);
    const lim = new HostRateLimiter(clock.deps);
    // Task 1 takes "instant" (no clock advance inside task). Finishes at t=0.
    await lim.run("a.com", async () => "first", 100);
    // Task 2 should wait 100ms via sleep before running. Since
    // our fake sleep advances the clock synchronously, we can
    // observe the advance.
    const before = clock.read();
    await lim.run("a.com", async () => "second", 100);
    const elapsed = clock.read() - before;
    assert.ok(elapsed >= 100, `expected ≥100ms elapsed, got ${elapsed}`);
  });

  it("doesn't wait when the previous call finished long ago", async () => {
    const clock = controllableClock(0);
    const lim = new HostRateLimiter(clock.deps);
    await lim.run("a.com", async () => "first", 100);
    clock.tick(500); // simulated 500ms pass before next call
    const before = clock.read();
    await lim.run("a.com", async () => "second", 100);
    // Second call shouldn't have slept — 500ms > 100ms already elapsed.
    assert.equal(clock.read() - before, 0);
  });

  it("uses DEFAULT_MIN_DELAY_MS when no delay is specified", async () => {
    const clock = controllableClock(0);
    const lim = new HostRateLimiter(clock.deps);
    await lim.run("a.com", async () => "first");
    const before = clock.read();
    await lim.run("a.com", async () => "second");
    assert.ok(clock.read() - before >= DEFAULT_MIN_DELAY_MS, `expected default ${DEFAULT_MIN_DELAY_MS}ms delay, got ${clock.read() - before}`);
  });

  it("marks finishedAt even on error so the next retry waits", async () => {
    const clock = controllableClock(0);
    const lim = new HostRateLimiter(clock.deps);
    await assert.rejects(() =>
      lim.run(
        "a.com",
        async () => {
          throw new Error("nope");
        },
        200,
      ),
    );
    const before = clock.read();
    await lim.run("a.com", async () => "ok", 200);
    // Second call still waits the full delay.
    assert.ok(clock.read() - before >= 200);
  });

  it("host matching is case-insensitive", async () => {
    const clock = controllableClock(0);
    const lim = new HostRateLimiter(clock.deps);
    await lim.run("Example.COM", async () => "first", 100);
    const before = clock.read();
    await lim.run("example.com", async () => "second", 100);
    // Same host under different case → still gated by delay.
    assert.ok(clock.read() - before >= 100);
  });
});

describe("HostRateLimiter — evictIdle", () => {
  it("removes hosts whose last finish is older than idleMs", async () => {
    const clock = controllableClock(0);
    const lim = new HostRateLimiter(clock.deps);
    await lim.run("old.com", async () => "x", 0);
    clock.tick(5_000);
    await lim.run("fresh.com", async () => "y", 0);
    assert.equal(lim.hostCount(), 2);
    const removed = lim.evictIdle(1_000);
    assert.equal(removed, 1);
    assert.equal(lim.hostCount(), 1);
  });

  it("returns 0 when nothing is idle", async () => {
    const clock = controllableClock(0);
    const lim = new HostRateLimiter(clock.deps);
    await lim.run("x.com", async () => null, 0);
    const removed = lim.evictIdle(60_000);
    assert.equal(removed, 0);
  });

  it("does not evict a host with queued / in-flight work even if lastFinishedAt is stale", async () => {
    // Regression: evictIdle used to look only at lastFinishedAt,
    // which can be old while new work sits queued behind a running
    // task. Deleting the state mid-run would let the next run()
    // recreate a fresh chain and drop serialization guarantees.
    const clock = controllableClock(0);
    const lim = new HostRateLimiter(clock.deps);

    // Prime lastFinishedAt so the entry looks "old".
    await lim.run("busy.com", async () => null, 0);
    clock.tick(10_000);

    // Kick off a second task that hangs (we never resolve it within
    // the test). activeCount → 1, lastFinishedAt stays at t=0, so
    // evictIdle would have deleted it under the old rule.
    let releaseTask: () => void = () => {};
    const taskGate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const inFlight = lim.run(
      "busy.com",
      async () => {
        await taskGate;
        return null;
      },
      0,
    );

    // Let the microtask queue flush so activeCount is observed.
    await Promise.resolve();

    const removed = lim.evictIdle(1_000);
    assert.equal(removed, 0);
    assert.equal(lim.hostCount(), 1);

    releaseTask();
    await inFlight;
  });
});
