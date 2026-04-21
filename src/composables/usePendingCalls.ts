// Composable that bundles the "minimum visible duration" trick for
// pending tool call rows: while the agent is running, tick a counter
// every 50ms so the `pendingCalls` computed re-evaluates and any
// freshly-resolved call stays visible for at least PENDING_MIN_MS
// before disappearing. After the run ends, schedule one final tick
// so the computed clears the lingering rows.

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type { ToolCallHistoryItem } from "../types/toolCallHistory";
import { isCallStillPending, PENDING_MIN_MS } from "../utils/tools/pendingCalls";

interface UsePendingCallsOptions {
  isRunning: ComputedRef<boolean> | Ref<boolean>;
  toolCallHistory: ComputedRef<ToolCallHistoryItem[]> | Ref<ToolCallHistoryItem[]>;
}

export function usePendingCalls(opts: UsePendingCallsOptions) {
  const displayTick = ref(0);
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  // Tracked so teardown can cancel the lingering "final tick" and we
  // never mutate displayTick after the composable's owner unmounts.
  let delayedTickTimeout: ReturnType<typeof setTimeout> | null = null;

  watch(
    opts.isRunning,
    (running) => {
      if (running) {
        // Guard against double-start: if the watcher fires twice with
        // running=true (e.g. immediate + a synchronous flip), don't
        // stack a second interval.
        if (tickInterval !== null) return;
        tickInterval = setInterval(() => {
          displayTick.value++;
        }, 50);
      } else if (tickInterval !== null) {
        clearInterval(tickInterval);
        tickInterval = null;
        // One final tick so the computed clears after the minimum
        // duration has elapsed. Cancel any previous pending one first
        // so back-to-back start/stop runs do not stack timeouts.
        if (delayedTickTimeout !== null) clearTimeout(delayedTickTimeout);
        delayedTickTimeout = setTimeout(() => {
          displayTick.value++;
          delayedTickTimeout = null;
        }, PENDING_MIN_MS);
      }
    },
    // immediate so a composable created while a run is already in
    // flight (e.g. mounted mid-stream) starts ticking right away
    // instead of waiting for the next isRunning flip.
    { immediate: true },
  );

  const pendingCalls = computed(() => {
    // Read displayTick to register the computed as a reactive
    // dependency on it — that is how a freshly-resolved row stays
    // visible for the minimum window. The `__` prefix tells ESLint
    // (varsIgnorePattern: "^__") that the variable is intentionally
    // unused.
    const __tickDep = displayTick.value;
    const now = Date.now();
    return opts.toolCallHistory.value.filter((entry) => __tickDep >= 0 && isCallStillPending(entry, now));
  });

  function teardown(): void {
    if (tickInterval !== null) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    if (delayedTickTimeout !== null) {
      clearTimeout(delayedTickTimeout);
      delayedTickTimeout = null;
    }
  }

  return { pendingCalls, teardown };
}
