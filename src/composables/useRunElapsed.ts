// setInterval, not rAF: tab-throttled rAF freezes in background tabs and the user expects elapsed to keep ticking
// across tab switches. Second-granularity is enough — the consumer renders one badge per run, not per pending row.

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
        // Guard against double-start (immediate + synchronous flip would otherwise stack intervals).
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
    // Immediate: a composable mounted mid-stream starts ticking right away.
    { immediate: true },
  );

  const elapsedMs = computed<number | null>(() => {
    if (startedAt.value === null) return null;
    return now.value - startedAt.value;
  });

  function teardown(): void {
    // Stop the watcher first — otherwise an isRunning flip after teardown recreates the interval (#798 Codex iter-1).
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
