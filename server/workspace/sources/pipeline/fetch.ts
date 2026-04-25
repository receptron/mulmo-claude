// Fetch-phase orchestrator.
//
// Given a planned list of eligible sources, runs each through
// its registered fetcher concurrently (Q7: parallel across
// hosts; same-host serialization happens inside HostRateLimiter
// at the HTTP layer). Failures are isolated per-source (Q8) —
// one bad fetch never aborts the pass.
//
// Each source produces a `FetchOutcome` summarizing success or
// failure. The next-state computation (backoff, failure counter,
// cursor persistence) is factored into `computeNextState` so the
// state-update policy is unit-testable without touching HTTP.

import type { FetcherDeps, FetchResult, SourceFetcher } from "../fetchers/index.js";
import type { FetcherKind, Source, SourceState } from "../types.js";
import { defaultSourceState } from "../types.js";
import { errorMessage } from "../../../utils/errors.js";
import { ONE_MINUTE_MS, ONE_HOUR_MS, ONE_DAY_MS } from "../../../utils/time.js";
import { log } from "../../../system/logger/index.js";

// Outcome of one source's fetch attempt.
export type FetchOutcome =
  | {
      kind: "success";
      sourceSlug: string;
      items: FetchResult["items"];
      cursor: FetchResult["cursor"];
    }
  | { kind: "no-fetcher"; sourceSlug: string; error: string }
  | { kind: "error"; sourceSlug: string; error: string };

export interface FetchPhaseInput {
  sources: readonly Source[];
  statesBySlug: ReadonlyMap<string, SourceState>;
  deps: FetcherDeps;
  // Injected so tests don't depend on the module-level registry.
  // Production passes `getFetcher` from fetchers/index.
  getFetcher: (kind: FetcherKind) => SourceFetcher | null;
}

export interface FetchPhaseResult {
  // In the original order of `input.sources` for caller
  // ergonomics; the per-outcome `sourceSlug` is the authoritative
  // key.
  outcomes: FetchOutcome[];
}

// Run the fetch phase. All fetchers run in parallel
// (Promise.all) — same-host serialization is enforced deeper,
// inside `HostRateLimiter` via the fetchers' `fetchPolite`
// calls. A single-source error never throws out of here;
// failures are captured in `FetchOutcome.kind === "error"`.
export async function runFetchPhase(input: FetchPhaseInput): Promise<FetchPhaseResult> {
  const outcomes = await Promise.all(
    input.sources.map((source) => fetchOneSource(source, input.statesBySlug.get(source.slug) ?? defaultSourceState(source.slug), input.deps, input.getFetcher)),
  );
  return { outcomes };
}

async function fetchOneSource(
  source: Source,
  state: SourceState,
  deps: FetcherDeps,
  getFetcher: (kind: FetcherKind) => SourceFetcher | null,
): Promise<FetchOutcome> {
  const fetcher = getFetcher(source.fetcherKind);
  if (!fetcher) {
    log.warn("pipeline.fetch", "no fetcher registered", {
      sourceSlug: source.slug,
      fetcherKind: source.fetcherKind,
    });
    return {
      kind: "no-fetcher",
      sourceSlug: source.slug,
      error: `no fetcher registered for kind "${source.fetcherKind}"`,
    };
  }
  log.debug("pipeline.fetch", "fetcher start", {
    sourceSlug: source.slug,
    fetcherKind: source.fetcherKind,
  });
  try {
    const result = await fetcher.fetch(source, state, deps);
    log.debug("pipeline.fetch", "fetcher ok", {
      sourceSlug: source.slug,
      fetcherKind: source.fetcherKind,
      items: result.items.length,
    });
    return {
      kind: "success",
      sourceSlug: source.slug,
      items: result.items,
      cursor: result.cursor,
    };
  } catch (err) {
    // Per-source warn: the pipeline's outer catch in
    // computeNextState handles backoff, but without this log a
    // single bad RSS feed throws no trace anywhere — the user's
    // exact complaint in #779.
    log.warn("pipeline.fetch", "fetcher threw", {
      sourceSlug: source.slug,
      fetcherKind: source.fetcherKind,
      error: errorMessage(err),
    });
    return {
      kind: "error",
      sourceSlug: source.slug,
      error: errorMessage(err),
    };
  }
}

// --- per-source state update --------------------------------------------

// Exponential backoff (in ms) for the Nth consecutive failure.
// Bounded at BACKOFF_MAX so even a permanently-broken source
// gets retried eventually.
export const BACKOFF_MAX_MS = ONE_DAY_MS;

export function backoffDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  // 1m, 2m, 4m, 8m, 16m, ..., capped at 24h.
  const base = ONE_MINUTE_MS;
  const delayMs = base * 2 ** Math.min(consecutiveFailures - 1, 20);
  return Math.min(delayMs, BACKOFF_MAX_MS);
}

// Number of consecutive empty fetches before adaptive backoff kicks in.
export const EMPTY_FETCH_THRESHOLD = 3;
export const EMPTY_BACKOFF_MAX_MS = ONE_DAY_MS;

// Exponential backoff (in ms) for Nth consecutive empty-success fetch.
// Returns 0 when below the threshold so callers can use it as a guard.
// Starts at 1h after threshold, doubling each time up to 24h.
export function emptyBackoffDelayMs(consecutiveEmptyFetches: number): number {
  if (consecutiveEmptyFetches < EMPTY_FETCH_THRESHOLD) return 0;
  const steps = consecutiveEmptyFetches - EMPTY_FETCH_THRESHOLD;
  const delayMs = ONE_HOUR_MS * 2 ** Math.min(steps, 10);
  return Math.min(delayMs, EMPTY_BACKOFF_MAX_MS);
}

// Compute the next per-source state given the outcome. Pure.
//
// On success with items:
//   - lastFetchedAt = now, cursor updated
//   - consecutiveFailures = 0, nextAttemptAt = null
//   - consecutiveEmptyFetches = 0, emptyBackoffUntil = null
// On success with 0 items:
//   - lastFetchedAt = now, cursor updated
//   - consecutiveFailures = 0, nextAttemptAt = null
//   - consecutiveEmptyFetches += 1
//   - emptyBackoffUntil = now + emptyBackoffDelayMs(newCount) if above threshold
// On any non-success:
//   - lastFetchedAt/cursor unchanged
//   - consecutiveFailures += 1, nextAttemptAt = now + backoffDelayMs(newCount)
//   - consecutiveEmptyFetches/emptyBackoffUntil unchanged
export function computeNextState(prev: SourceState, outcome: FetchOutcome, nowMs: number): SourceState {
  if (outcome.kind === "success") {
    const hasItems = outcome.items.length > 0;
    const emptyCount = hasItems ? 0 : prev.consecutiveEmptyFetches + 1;
    const emptyDelayMs = emptyBackoffDelayMs(emptyCount);
    return {
      slug: prev.slug,
      lastFetchedAt: new Date(nowMs).toISOString(),
      cursor: outcome.cursor,
      consecutiveFailures: 0,
      nextAttemptAt: null,
      consecutiveEmptyFetches: emptyCount,
      emptyBackoffUntil: emptyDelayMs > 0 ? new Date(nowMs + emptyDelayMs).toISOString() : null,
    };
  }
  const failures = prev.consecutiveFailures + 1;
  return {
    slug: prev.slug,
    lastFetchedAt: prev.lastFetchedAt,
    cursor: prev.cursor,
    consecutiveFailures: failures,
    nextAttemptAt: new Date(nowMs + backoffDelayMs(failures)).toISOString(),
    consecutiveEmptyFetches: prev.consecutiveEmptyFetches,
    emptyBackoffUntil: prev.emptyBackoffUntil,
  };
}
