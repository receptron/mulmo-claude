// Render a millisecond duration as a short, human-readable string for
// the Thinking indicator. Granularity adapts to the magnitude — sub-
// second elapsed (typical for fast tool calls) shows one decimal so
// the user sees movement; minutes/hours collapse to the largest two
// units so the line stays compact.
//
// Used by the agent run-elapsed counter (#731 PR2) and the per-tool
// elapsed badge in `ToolResultsPanel.vue`.

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

export function formatElapsed(elapsedMs: number): string {
  // Defensive: clamp negatives to zero so a clock-skew or stale-tick
  // race never renders "-0s".
  const elapsed = elapsedMs > 0 ? elapsedMs : 0;
  if (elapsed < ONE_SECOND_MS) {
    // Floor to one decimal so the badge never reads ahead of the
    // clock — `toFixed(1)` rounds half-up and would render 999ms as
    // "1.0s" (Codex iter-1 #798). Keep the integer-second branch's
    // "floor not round" rule consistent here.
    const tenths = Math.floor(elapsed / 100);
    return `${(tenths / 10).toFixed(1)}s`;
  }
  if (elapsed < ONE_MINUTE_MS) {
    return `${Math.floor(elapsed / ONE_SECOND_MS)}s`;
  }
  if (elapsed < ONE_HOUR_MS) {
    const minutes = Math.floor(elapsed / ONE_MINUTE_MS);
    const seconds = Math.floor((elapsed % ONE_MINUTE_MS) / ONE_SECOND_MS);
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(elapsed / ONE_HOUR_MS);
  const minutes = Math.floor((elapsed % ONE_HOUR_MS) / ONE_MINUTE_MS);
  return `${hours}h ${minutes}m`;
}
