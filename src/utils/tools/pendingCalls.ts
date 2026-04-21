// Pure logic for "is this tool call still considered pending right
// now?" — extracted so it can be unit-tested without spinning up a
// Vue reactive scope. The composable in src/composables/usePendingCalls
// pairs this with the timing / interval bookkeeping.

import type { ToolCallHistoryItem } from "../../types/toolCallHistory";

// A freshly-resolved call is held visible for this many milliseconds
// after its result lands, so the spinner / loading row does not flash
// off the screen if the response was very fast.
export const PENDING_MIN_MS = 500;

export function isCallStillPending(call: ToolCallHistoryItem, nowMs: number): boolean {
  if (call.result === undefined && call.error === undefined) return true;
  return nowMs < call.timestamp + PENDING_MIN_MS;
}
