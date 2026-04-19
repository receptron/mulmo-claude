// Per-host rate limiter for outbound HTTP fetches.
//
// Design decision from #188 Q7: fetchers run parallel across hosts
// but serial per host. This module is the "serial per host" part.
// Two concurrent requests to the same hostname wait in FIFO order;
// different hostnames proceed independently.
//
// Mechanism:
//
// - Per-host chain: one `Promise<void>` per hostname. Each new
//   request `await`s the previous promise, runs the work, then
//   releases the next waiter.
// - Minimum delay: optional per-host floor between the end of one
//   request and the start of the next. Defaults to
//   DEFAULT_MIN_DELAY_MS to keep us well-behaved on cooperative
//   hosts; robots.txt `Crawl-delay` callers pass their host's
//   value.
// - Clock-injectable: the `now` + `sleep` deps make this testable
//   without wall-clock waits.
//
// Pure in the sense that all state is captured in the limiter
// instance — no module-level globals. Tests can spin up a fresh
// limiter per case and fully observe the ordering.

// Seconds of quiet between requests to the same host when the
// caller doesn't specify an explicit `minDelayMs` for the host.
// One second is polite-default for public feeds.
export const DEFAULT_MIN_DELAY_MS = 1000;

export interface RateLimiterDeps {
  // Returns current wall-clock milliseconds. `Date.now` in prod,
  // tests inject a controllable counter.
  now: () => number;
  // Sleep for `ms` milliseconds. `setTimeout` wrapper in prod,
  // tests inject a faketimer-backed implementation.
  sleep: (ms: number) => Promise<void>;
}

export function defaultRateLimiterDeps(): RateLimiterDeps {
  return {
    now: () => Date.now(),
    sleep: (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

interface HostState {
  // Tail of the per-host promise chain. New work waits for this,
  // then replaces it with its own completion promise.
  tail: Promise<void>;
  // Wall-clock time the most-recent completed request returned,
  // or `null` when no request has completed yet. Using `null`
  // rather than 0 as the sentinel avoids ambiguity against fake
  // test clocks that legitimately start at t=0.
  lastFinishedAt: number | null;
  // Number of tasks currently queued or in-flight for this host.
  // Must hit zero before the host is eligible for eviction —
  // otherwise evictIdle can delete a state with pending work,
  // letting a later run() recreate a fresh chain and break serial
  // ordering.
  activeCount: number;
}

export class HostRateLimiter {
  private readonly hosts = new Map<string, HostState>();
  private readonly deps: RateLimiterDeps;

  constructor(deps: RateLimiterDeps = defaultRateLimiterDeps()) {
    this.deps = deps;
  }

  // Run `task` under the host's rate-limit slot. Resolves with the
  // task's return value, or rejects with the task's error (without
  // poisoning the queue — the next waiter still gets to run).
  //
  // `minDelayMs` is the minimum ms between the END of the previous
  // request to this host and the START of this one. Defaults to
  // DEFAULT_MIN_DELAY_MS.
  run<T>(
    host: string,
    task: () => Promise<T>,
    minDelayMs: number = DEFAULT_MIN_DELAY_MS,
  ): Promise<T> {
    const key = host.toLowerCase();
    const state: HostState = this.hosts.get(key) ?? {
      tail: Promise.resolve(),
      lastFinishedAt: null,
      activeCount: 0,
    };
    const prev = state.tail;

    // Build the new tail: wait for prev, enforce delay, run task.
    let resolveTail: () => void = () => {};
    const newTail = new Promise<void>((resolve) => {
      resolveTail = resolve;
    });
    state.tail = newTail;
    state.activeCount++;
    this.hosts.set(key, state);

    return (async () => {
      try {
        await prev;
        const wait =
          state.lastFinishedAt === null
            ? 0
            : minDelayMs - (this.deps.now() - state.lastFinishedAt);
        if (wait > 0) await this.deps.sleep(wait);
        try {
          return await task();
        } finally {
          // Mark finished time even on error so a flapping host
          // doesn't get spammed with retries. Read state from the
          // map (rather than the closure-captured variable) in
          // case a parallel call has since updated it.
          const fresh = this.hosts.get(key);
          if (fresh) fresh.lastFinishedAt = this.deps.now();
        }
      } finally {
        resolveTail();
        const fresh = this.hosts.get(key);
        if (fresh) fresh.activeCount--;
      }
    })();
  }

  // Test / debug: how many hosts currently have a chain. Returns
  // 0 when the limiter is fresh.
  hostCount(): number {
    return this.hosts.size;
  }

  // Release internal state for hosts that have been idle longer
  // than `idleMs`. Not strictly required for correctness (the
  // map grows linearly with distinct hosts, which is bounded for
  // any real workspace), but handy for long-lived processes.
  evictIdle(idleMs: number): number {
    const cutoff = this.deps.now() - idleMs;
    let removed = 0;
    for (const [key, state] of this.hosts) {
      // Only evict states whose queue is empty. An idle
      // `lastFinishedAt` alone isn't enough — if `tail` still has
      // queued or in-flight work we'd delete live state and a
      // later run() would recreate a fresh chain, breaking serial
      // per-host ordering.
      if (state.activeCount > 0) continue;
      if (state.lastFinishedAt !== null && state.lastFinishedAt < cutoff) {
        this.hosts.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
