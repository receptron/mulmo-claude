// Pure logic for "is this tool call still considered pending right
// now?" — extracted so it can be unit-tested without spinning up a
// Vue reactive scope. The composable in src/composables/usePendingCalls
// pairs this with the timing / interval bookkeeping.

import type { ToolCallHistoryItem } from "../../types/toolCallHistory";

// A freshly-resolved call is held visible for this many milliseconds
// after its result lands, so the spinner / loading row does not flash
// off the screen if the response was very fast.
export const PENDING_MIN_MS = 500;

// How often the "still pending?" computed is forced to re-evaluate
// while a run is in flight. Picking a value much smaller than
// PENDING_MIN_MS is what lets the computed drop a resolved row
// within one tick of its minimum window elapsing. 50ms gives a ~10×
// margin over the 500ms visibility window, which is plenty.
export const PENDING_TICK_INTERVAL_MS = 50;

export function isCallStillPending(
  call: ToolCallHistoryItem,
  nowMs: number,
): boolean {
  if (call.result === undefined && call.error === undefined) return true;
  return nowMs < call.timestamp + PENDING_MIN_MS;
}
