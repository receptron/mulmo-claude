// Investigation-only performance instrumentation for the session-list
// slowness (left history panel). Everything here is inert unless the
// reader opts in at runtime from the browser console:
//
//   localStorage.setItem("mulmoclaude:perf", "1"); location.reload();
//
// The flag is read once at module load, so a disabled session pays only
// a boolean check per call site. Remove this module (and its call sites)
// once the investigation lands a fix.
//
// Re-applied on top of the #2809 fix (#2813) to re-measure the same
// paths. Ported from #2810 with two changes the fix made necessary:
//   - accumulators flush even at zero calls, because "0 formatDate calls
//     per click" is now the result being looked for, not an absence
//   - a tally for how many rows actually re-render per click, which is
//     what the row-component split was supposed to change

const PERF_FLAG_KEY = "mulmoclaude:perf";
const LOG_PREFIX = "[perf]";
const MS_DECIMALS = 1;
const LABEL_WIDTH = 34;
const VALUE_WIDTH = 10;
const MS_PER_SECOND = 1000;

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
  console.log(`${LOG_PREFIX} ${label.padEnd(LABEL_WIDTH)} ${format(elapsedMs).padStart(VALUE_WIDTH)}`, extra ?? "");
}

/** Report context that is a count rather than a duration (list sizes,
 *  entry counts) without pretending it took 0 ms. */
export function perfNote(label: string, extra: Record<string, unknown>): void {
  if (!perfEnabled) return;
  console.log(`${LOG_PREFIX} ${label.padEnd(LABEL_WIDTH)}`, extra);
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

// ── Component breakdown ─────────────────────────────────────────────
// `app.config.performance = true` (src/main.ts) makes Vue emit a
// `performance.measure` per component init / render / patch. Collecting
// them per click answers "which component owns the frame the click waits
// for" without hand-instrumenting each pane. Vue's measures NEST (a
// parent's patch contains its children's), so the durations overlap —
// read the ranking, not the sum.

interface MeasureRecord {
  name: string;
  startTime: number;
  duration: number;
}

const MEASURE_MIN_MS = 1;
const MEASURE_TOP_N = 12;
const MEASURE_BUFFER_MAX = 4000;
const NAME_WIDTH = 40;

const measures: MeasureRecord[] = [];

if (perfEnabled && typeof PerformanceObserver !== "undefined") {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      measures.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration });
    }
    if (measures.length > MEASURE_BUFFER_MAX) measures.splice(0, measures.length - MEASURE_BUFFER_MAX);
  });
  observer.observe({ entryTypes: ["measure"] });
}

let dumpedClickAt = 0;

function dumpMeasuresSinceClick(clickAt: number): void {
  if (dumpedClickAt === clickAt) return;
  dumpedClickAt = clickAt;
  const totals = new Map<string, { ms: number; calls: number }>();
  for (const record of measures.filter((entry) => entry.startTime >= clickAt)) {
    const acc = totals.get(record.name) ?? { ms: 0, calls: 0 };
    totals.set(record.name, { ms: acc.ms + record.duration, calls: acc.calls + 1 });
  }
  const ranked = [...totals.entries()]
    .map(([name, acc]) => ({ name, ...acc }))
    .filter((row) => row.ms >= MEASURE_MIN_MS)
    .sort((left, right) => right.ms - left.ms)
    .slice(0, MEASURE_TOP_N);
  console.log(`${LOG_PREFIX} ── component breakdown for this click (${totals.size} distinct, nested: durations overlap)`);
  for (const row of ranked) {
    console.log(`${LOG_PREFIX}   ${row.name.padEnd(NAME_WIDTH)} ${row.ms.toFixed(MS_DECIMALS).padStart(VALUE_WIDTH)} ms  x${row.calls}`);
  }
}

// ── Click clock ─────────────────────────────────────────────────────
// One click updates three things the reader notices at different
// moments: the row's own selected border, the middle pane's transcript,
// and the canvas. They live in different components, so the click time
// is parked here and each of them reports its own distance from it.

let lastClickAt = 0;

/** Stamp the moment the user pressed a session row. */
export function perfMarkClick(): void {
  if (!perfEnabled) return;
  lastClickAt = performance.now();
  measures.length = 0;
}

/** The click currently being measured, for callers that need to time a
 *  synchronous span rather than a paint (0 before the first click). */
export function perfClickAt(): number {
  return lastClickAt;
}

/** Report when this part of the UI actually finished painting, measured
 *  from the click that caused it. No-op before the first click. */
export function perfLogSinceClick(label: string, extra?: Record<string, unknown>): void {
  if (!perfEnabled || lastClickAt === 0) return;
  const clickAt = lastClickAt;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      perfLog(label, performance.now() - clickAt, extra);
      // Several call sites report the same click; only the first one to
      // paint prints the breakdown.
      dumpMeasuresSinceClick(clickAt);
    });
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

  // Logs even when `calls` is 0 — after #2813 the per-row work sits
  // behind `computed`, so "this pass re-ran it 0 times" is the finding.
  function flush(label: string, extra?: Record<string, unknown>): void {
    if (!perfEnabled) return;
    perfLog(label, totalMs, { calls, ...extra });
    totalMs = 0;
    calls = 0;
  }

  return { add, flush };
}

/** Counts occurrences within one render pass (how many row components
 *  actually re-rendered) and reports them the same way as the
 *  accumulators, so a click's whole cost reads as one block. */
export interface PerfTally {
  bump: () => void;
  flush: (label: string, extra?: Record<string, unknown>) => void;
}

export function createPerfTally(): PerfTally {
  let count = 0;
  return {
    bump(): void {
      if (!perfEnabled) return;
      count += 1;
    },
    flush(label: string, extra?: Record<string, unknown>): void {
      if (!perfEnabled) return;
      perfNote(label, { count, ...extra });
      count = 0;
    },
  };
}

// ── Session-row render pass ─────────────────────────────────────────
// The per-row work now lives in SessionHistoryRow.vue (one component
// instance per row) while the pass that contains it is owned by
// SessionHistoryPanel.vue, so the accumulators are shared here rather
// than held by either component.

export const rowPerf = {
  renders: createPerfTally(),
  timestamp: createPerfAccumulator(),
  aria: createPerfAccumulator(),
  primaryText: createPerfAccumulator(),
};

/** Report one render pass of the list: how many row components actually
 *  re-rendered, and what the per-row string work cost inside them. */
export function flushRowPerf(pass: string, rows: number): void {
  rowPerf.renders.flush(`${pass}: rows re-rendered`, { rows });
  rowPerf.timestamp.flush(`${pass}: formatDate()`);
  rowPerf.aria.flush(`${pass}: t(openRowAria)`);
  rowPerf.primaryText.flush(`${pass}: primaryText()`);
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
      const elapsedSec = (performance.now() - startedAt) / MS_PER_SECOND;
      console.log(`${LOG_PREFIX} ${label.padEnd(LABEL_WIDTH)} #${count} @ ${elapsedSec.toFixed(1)}s`, extra ?? "");
    },
  };
}
