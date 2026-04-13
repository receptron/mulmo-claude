import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HostRateLimiter,
  DEFAULT_MIN_DELAY_MS,
  type RateLimiterDeps,
} from "../../server/sources/rateLimiter.js";

// Build a controllable clock + sleep for deterministic tests.
// `now()` returns a mutable counter; `sleep(ms)` advances the
// counter synchronously and resolves on the next microtask so
// task ordering is preserved without real timers.
function makeFakeClock(start = 0): {
  deps: RateLimiterDeps;
  advance: (ms: number) => void;
  readonly current: number;
} {
  const state = { current: start };
  return {
    current: 0,
    get deps() {
      return {
        now: () => state.current,
        sleep: (ms: number) => {
          state.current += ms;
          return Promise.resolve();
        },
      };
    },
    advance(ms: number) {
      state.current += ms;
    },
    // Proxy so `current` reflects state live.
    ...Object.defineProperty(
      { advance: (ms: number) => (state.current += ms) },
      "current",
      { get: () => state.current },
    ),
  };
}

// Simpler alternative when we don't need live-binding; returns a
// deps object plus direct state access.
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
    const lim = new HostRateLimiter(deps, ...[].slice()); // eslint noise
    // The semaphore-like invariant: if two run() calls are issued
    // back-to-back on the same host, the second task must not
    // start until the first has completed.
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const first = lim.run(
      "example.com",
      async () => {
        events.push("first:start");
        await new Promise<void>((r) => {
          releaseFirst = r;
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
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, 1);
    assert.equal(b, 2);
    assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
  });

  it("allows different hosts to run concurrently", async () => {
    const { deps } = controllableClock();
    const lim = new HostRateLimiter(deps);
    const events: string[] = [];
    let releaseA: () => void = () => {};
    const a = lim.run(
      "a.com",
      async () => {
        events.push("a:start");
        await new Promise<void>((r) => {
          releaseA = r;
        });
        events.push("a:end");
        return "a";
      },
      0,
    );
    const b = lim.run(
      "b.com",
      async () => {
        events.push("b:start");
        return "b";
      },
      0,
    );
    // Let both tasks schedule. a is still awaiting; b should
    // have completed.
    const bResult = await b;
    assert.equal(bResult, "b");
    // b:start must have happened BEFORE a finishes — distinct
    // hosts don't serialize.
    assert.deepEqual(events, ["a:start", "b:start"]);
    releaseA();
    await a;
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
    assert.ok(
      clock.read() - before >= DEFAULT_MIN_DELAY_MS,
      `expected default ${DEFAULT_MIN_DELAY_MS}ms delay, got ${clock.read() - before}`,
    );
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
});
