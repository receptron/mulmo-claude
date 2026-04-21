// Fetcher dispatcher.
//
// Each source in the registry has a `fetcherKind` that maps to a
// module under `server/sources/fetchers/<kind>.ts` implementing
// the `SourceFetcher` interface. The pipeline looks up the right
// fetcher via `getFetcher(kind)`, then calls `fetcher.fetch(...)`.
//
// Adding a new fetcher kind in phase 2 / 3 / later:
//   1. Create `server/sources/fetchers/<new-kind>.ts` exporting
//      a `SourceFetcher` and calling `registerFetcher(...)` at
//      the bottom so the module self-registers on import.
//   2. Add the string to `FETCHER_KINDS` in `../types.ts`.
//   3. **Add a side-effect import for the new module to
//      `./registerAll.ts`.** Production entry points import that
//      barrel; without this step the pipeline still resolves
//      `getFetcher(kind)` to `null` and your fetcher never runs.
//   4. Add a case to `test/sources/test_fetcherRegistration.ts`
//      so regressions fail a unit test.
// No other framework change is required.

import type { HttpFetcherDeps } from "../httpFetcher.js";
import type { FetcherKind, Source, SourceItem, SourceState } from "../types.js";

// Per-run dependencies threaded into every fetcher so all I/O
// goes through injectable hooks (tests never touch the network).
export interface FetcherDeps {
  // Wiring for `fetchPolite` — robots provider, rate limiter,
  // fetch impl, timeout. Shared across fetchers in one pipeline
  // run so their per-host rate limits serialize together.
  http: HttpFetcherDeps;
  // Monotonic wall-clock. Fetchers timestamp new items and update
  // the cursor with it.
  now: () => number;
  // Pipeline-wide abort (e.g. server shutdown). Separate from
  // the per-fetch timeout that lives inside `http`.
  signal?: AbortSignal;
}

export interface FetchResult {
  // Newly-discovered items (already filtered against the cursor).
  // Empty array is a valid outcome — "no new items since last run".
  items: SourceItem[];
  // Replacement cursor for SourceState. Fetchers return only the
  // keys they own; the caller merges this into the existing state.
  cursor: Record<string, string>;
}

export interface SourceFetcher {
  readonly kind: FetcherKind;
  fetch(source: Source, state: SourceState, deps: FetcherDeps): Promise<FetchResult>;
}

// Registry of all known fetchers. Populated lazily via
// `registerFetcher` so each fetcher module is responsible for
// adding itself at import time — keeps the dispatcher free of
// hard dependencies on modules that may pull heavy deps
// (fast-xml-parser etc).
const FETCHERS = new Map<FetcherKind, SourceFetcher>();

export function registerFetcher(fetcher: SourceFetcher): void {
  FETCHERS.set(fetcher.kind, fetcher);
}

export function getFetcher(kind: FetcherKind): SourceFetcher | null {
  return FETCHERS.get(kind) ?? null;
}

// Test-only: clear the registry between cases.
export function __resetFetchersForTests(): void {
  FETCHERS.clear();
}
