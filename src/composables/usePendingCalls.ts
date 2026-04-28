// "Minimum visible duration" trick: tick every 50ms while running so a freshly-resolved call stays on-screen for
// PENDING_MIN_MS before clearing. One final tick after the run ends sweeps lingering rows out of the computed.

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
  // Tracked so teardown can cancel the trailing tick — never mutate displayTick after the owner unmounts.
  let delayedTickTimeout: ReturnType<typeof setTimeout> | null = null;

  watch(
    opts.isRunning,
    (running) => {
      if (running) {
        // Guard against double-start (immediate + a synchronous flip would otherwise stack intervals).
        if (tickInterval !== null) return;
        tickInterval = setInterval(() => {
          displayTick.value++;
        }, 50);
      } else if (tickInterval !== null) {
        clearInterval(tickInterval);
        tickInterval = null;
        // Cancel any previous trailing tick so back-to-back start/stop runs don't stack timeouts.
        if (delayedTickTimeout !== null) clearTimeout(delayedTickTimeout);
        delayedTickTimeout = setTimeout(() => {
          displayTick.value++;
          delayedTickTimeout = null;
        }, PENDING_MIN_MS);
      }
    },
    // Immediate so a composable mounted mid-stream starts ticking right away instead of waiting for the next flip.
    { immediate: true },
  );

  const pendingCalls = computed(() => {
    // Reads displayTick purely to register a reactive dep — that's how rows linger for the minimum window.
    const __tickDep = displayTick.value;
    const now = Date.now();
    // #731 PR2: project to elapsedMs so the per-tool badge piggybacks on this 50ms ticker (no second ticker downstream).
    return opts.toolCallHistory.value
      .filter((entry) => __tickDep >= 0 && isCallStillPending(entry, now))
      .map((entry) => ({
        toolUseId: entry.toolUseId,
        toolName: entry.toolName,
        elapsedMs: now - entry.timestamp,
      }));
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
