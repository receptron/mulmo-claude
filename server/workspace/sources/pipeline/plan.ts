// Pipeline planner — pure.
//
// Given the current source registry + per-source state + the
// schedule type being run (daily / hourly / weekly), decide
// which sources should fetch this cycle:
//
//   1. Schedule match — a daily run skips hourly sources and
//      vice versa. "on-demand" sources are never picked up by
//      any scheduled run.
//   2. Backoff respect — sources with a `nextAttemptAt` in the
//      future are skipped until that time arrives, so a flapping
//      source doesn't monopolize the rate limit.
//
// Separate module so tests can pin the filtering semantics
// without touching the rest of the pipeline.

import type { Source, SourceSchedule, SourceState } from "../types.js";

export interface PlanInput {
  sources: readonly Source[];
  statesBySlug: ReadonlyMap<string, SourceState>;
  // Schedule type this run is handling. The caller (task-manager
  // cron or the manual `rebuild` endpoint) knows which kind it is.
  scheduleType: SourceSchedule;
  // Wall-clock ms since epoch. Passed in (rather than calling
  // Date.now() internally) so tests can drive a deterministic
  // clock.
  nowMs: number;
}

// Sort key: slug, ascending. Deterministic ordering keeps the
// daily summary's item sequence stable across runs for the same
// input, which makes markdown diffs readable.
function bySlug(a: Source, b: Source): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

// Returns the subset of sources eligible for this cycle. Pure.
export function planEligibleSources(input: PlanInput): Source[] {
  const eligible: Source[] = [];
  for (const source of input.sources) {
    if (source.schedule !== input.scheduleType) continue;
    if (!isWithinBackoff(input.statesBySlug.get(source.slug), input.nowMs)) {
      eligible.push(source);
    }
  }
  eligible.sort(bySlug);
  return eligible;
}

// True when the state indicates the source is STILL in backoff
// (so we should SKIP it). False means eligible to run now.
//
// - No state at all → run.
// - No nextAttemptAt → run.
// - nextAttemptAt unparseable → run (don't let a corrupt state
//   file permanently lock out a source).
// - nextAttemptAt in the future → skip.
// - nextAttemptAt at or before now → run.
function isWithinBackoff(
  state: SourceState | undefined,
  nowMs: number,
): boolean {
  if (!state) return false;
  if (!state.nextAttemptAt) return false;
  const ts = Date.parse(state.nextAttemptAt);
  if (!Number.isFinite(ts)) return false;
  return ts > nowMs;
}
