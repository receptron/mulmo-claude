// Stale-response guard for watcher-driven async fetches.
//
// Pattern: a watcher fires on bookId / filter / version changes
// and kicks off `apiPost(...)`. Without coordination, a slower
// earlier request can resolve after a newer one and overwrite the
// fresh state with stale data. This composable hands out a
// monotonic token before each await; the caller checks that the
// token is still current after the await before mutating state.
//
// Usage:
//
//   const { begin, isCurrent } = useLatestRequest();
//   async function refresh() {
//     const token = begin();
//     const result = await api.fetch(...);
//     if (!isCurrent(token)) return;          // a newer refresh started
//     applyState(result);
//   }
//
// Cheap and dependency-free. Each component holds its own
// `useLatestRequest()` instance — there's no shared state across
// components.

export interface LatestRequestApi {
  /** Returns the token of the new request. Increments the
   *  internal counter; older outstanding requests will fail
   *  `isCurrent`. */
  begin: () => number;
  /** True if `token` is still the most recently issued one. */
  isCurrent: (token: number) => boolean;
}

export function useLatestRequest(): LatestRequestApi {
  let counter = 0;
  return {
    begin(): number {
      counter += 1;
      return counter;
    },
    isCurrent(token: number): boolean {
      return token === counter;
    },
  };
}
