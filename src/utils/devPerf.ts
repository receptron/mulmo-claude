// Investigation-only performance instrumentation for the session-list
// slowness (left history panel). Everything here is inert unless the
// reader opts in at runtime from the browser console:
//
//   localStorage.setItem("mulmoclaude:perf", "1"); location.reload();
//
// The flag is read once at module load, so a disabled session pays only
// a boolean check per call site. Remove this module (and its call sites)
// once the investigation lands a fix.

const PERF_FLAG_KEY = "mulmoclaude:perf";
const LOG_PREFIX = "[perf]";
const MS_DECIMALS = 1;

function readFlag(): boolean {
  try {
    return window.localStorage.getItem(PERF_FLAG_KEY) === "1";
  } catch {
    // Private-mode Safari throws on localStorage access — treat as off.
    return false;
  }
}

export const perfEnabled = readFlag();

function format(elapsedMs: number): string {
  return `${elapsedMs.toFixed(MS_DECIMALS)} ms`;
}

/** Log one timing. `extra` carries whatever context makes the number
 *  interpretable (row counts, byte sizes, session ids). */
export function perfLog(label: string, elapsedMs: number, extra?: Record<string, unknown>): void {
  if (!perfEnabled) return;
  console.log(`${LOG_PREFIX} ${label.padEnd(34)} ${format(elapsedMs).padStart(10)}`, extra ?? "");
}

/** Report context that is a count rather than a duration (list sizes,
 *  entry counts) without pretending it took 0 ms. */
export function perfNote(label: string, extra: Record<string, unknown>): void {
  if (!perfEnabled) return;
  console.log(`${LOG_PREFIX} ${label.padEnd(34)}`, extra);
}

/** Time an async block and log it. Returns whatever the block returns. */
export async function perfTimeAsync<T>(label: string, run: () => Promise<T>, extra?: Record<string, unknown>): Promise<T> {
  if (!perfEnabled) return run();
  const started = performance.now();
  const result = await run();
  perfLog(label, performance.now() - started, extra);
  return result;
}

/** Time a synchronous block and log it. */
export function perfTime<T>(label: string, run: () => T, extra?: Record<string, unknown>): T {
  if (!perfEnabled) return run();
  const started = performance.now();
  const result = run();
  perfLog(label, performance.now() - started, extra);
  return result;
}

/** Log the time from `startedAt` until the browser has actually painted.
 *  Two rAFs: the first fires before paint, the second after it. This is
 *  the number that matches "when did the user see it change". */
export function perfLogUntilPaint(label: string, startedAt: number, extra?: Record<string, unknown>): void {
  if (!perfEnabled) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => perfLog(label, performance.now() - startedAt, extra));
  });
}

/** Sums many small calls (per-row work) across one render pass, so the
 *  cost of 800 individual `formatDate` / `t()` calls shows up as one
 *  line instead of 800. Call `add` around each unit, `flush` once the
 *  pass is over. */
export interface PerfAccumulator {
  add: <T>(run: () => T) => T;
  flush: (label: string, extra?: Record<string, unknown>) => void;
}

export function createPerfAccumulator(): PerfAccumulator {
  let totalMs = 0;
  let calls = 0;

  function add<T>(run: () => T): T {
    if (!perfEnabled) return run();
    const started = performance.now();
    const result = run();
    totalMs += performance.now() - started;
    calls += 1;
    return result;
  }

  function flush(label: string, extra?: Record<string, unknown>): void {
    if (!perfEnabled || calls === 0) return;
    perfLog(label, totalMs, { calls, ...extra });
    totalMs = 0;
    calls = 0;
  }

  return { add, flush };
}

/** Counts events (pub/sub-driven refetches) and reports the rate, so
 *  background churn unrelated to a click is visible. */
export function createPerfCounter(label: string) {
  const startedAt = performance.now();
  let count = 0;
  return {
    hit(extra?: Record<string, unknown>): void {
      if (!perfEnabled) return;
      count += 1;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      console.log(`${LOG_PREFIX} ${label.padEnd(34)} #${count} @ ${elapsedSec.toFixed(1)}s`, extra ?? "");
    },
  };
}
