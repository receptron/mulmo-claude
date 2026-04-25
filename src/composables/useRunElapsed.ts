// Tracks how long the active agent run has been going. While
// `isRunning` is true, `elapsedMs` updates once per second so the
// rendered string ("12s" / "1m 23s") moves visibly. When the run
// ends, `elapsedMs` flips back to null and the timer is cleared.
//
// Separated from `usePendingCalls` (which ticks every 50ms for the
// minimum-visible-duration trick) — the run-elapsed display only
// needs second-granularity, and the consumer renders one badge per
// run rather than one per pending row, so a tighter tick would just
// burn re-renders.
//
// Why a watcher + setInterval rather than a `requestAnimationFrame`
// driven computed: tab-throttled rAF freezes when the tab is in the
// background, and the user expects the elapsed counter to keep
// running across tab switches.

import { computed, ref, watch, type ComputedRef, type Ref, type WatchStopHandle } from "vue";

const ONE_SECOND_MS = 1000;

interface UseRunElapsedOptions {
  isRunning: ComputedRef<boolean> | Ref<boolean>;
}

export function useRunElapsed(opts: UseRunElapsedOptions): {
  elapsedMs: ComputedRef<number | null>;
  teardown: () => void;
} {
  const startedAt = ref<number | null>(null);
  const now = ref(0);
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopWatch: WatchStopHandle | null = null;

  stopWatch = watch(
    opts.isRunning,
    (running) => {
      if (running) {
        // Guard against double-start: if the watcher fires twice with
        // running=true (e.g. immediate + a synchronous flip), don't
        // stack a second interval.
        if (interval !== null) return;
        startedAt.value = Date.now();
        now.value = startedAt.value;
        interval = setInterval(() => {
          now.value = Date.now();
        }, ONE_SECOND_MS);
        return;
      }
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      startedAt.value = null;
    },
    // immediate so a composable created while a run is already in
    // flight (mounted mid-stream) starts ticking right away.
    { immediate: true },
  );

  const elapsedMs = computed<number | null>(() => {
    if (startedAt.value === null) return null;
    return now.value - startedAt.value;
  });

  function teardown(): void {
    // Stop the watcher first — otherwise an isRunning flip after
    // teardown would recreate the interval (Codex iter-1 #798).
    if (stopWatch !== null) {
      stopWatch();
      stopWatch = null;
    }
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
    startedAt.value = null;
  }

  return { elapsedMs, teardown };
}
