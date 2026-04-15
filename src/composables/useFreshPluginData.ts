// Shared fetch-fresh-data-on-mount pattern for plugin view / preview
// components. Each affected plugin (todo, scheduler, wiki, manageRoles)
// used to duplicate the same onMounted + AbortController + JSON parse
// + apply routine in 8 files. This composable factors it out and
// drives 3 distinct flavours via callbacks:
//
//   endpoint(): returns the URL to fetch. A function (not a string)
//     so callers can derive it from local refs — wiki/View picks
//     between /api/wiki and /api/wiki?slug=... depending on the
//     current action.
//
//   extract(json): pulls the data off the response envelope. Three
//     shapes in practice:
//       - json.data.items     (todo / scheduler)
//       - json.data           (wiki — the whole WikiData object)
//       - bare array          (manageRoles — /api/roles returns an
//                              unwrapped CustomRole[])
//     Return `null` to skip the apply step (e.g. response malformed
//     or the caller wants to ignore a particular payload).
//
//   apply(data): writes into the caller's local refs. Callers can
//     guard here — wiki/Preview only applies the index payload when
//     it's currently showing the index view, because the preview is
//     reused for page / log / lint_report previews.
//
// Lifecycle: `onMounted` fires one initial refresh. `onUnmounted`
// aborts any in-flight request. Callers can also call `refresh()`
// explicitly (e.g. from a `watch(() => props.selectedResult.uuid)`
// to re-fetch when switching between tool results).

import { onMounted, onUnmounted } from "vue";
import { apiGet } from "../utils/api";

export interface UseFreshPluginDataOptions<T> {
  endpoint: () => string;
  extract: (json: unknown) => T | null;
  apply: (data: T) => void;
}

export interface UseFreshPluginDataHandle {
  // Abort any in-flight fetch and fire a new one. Returns true if
  // the response was applied, false on abort / non-OK / malformed /
  // apply-skipped. Callers can await this when they want to know
  // whether the refresh succeeded (e.g. for a manual retry flow).
  refresh: () => Promise<boolean>;

  // Cancel any in-flight fetch without firing a new one. Called
  // automatically by the composable on component unmount.
  abort: () => void;
}

// Pure core of the refresh logic, exported separately so tests can
// exercise it without spinning up a Vue component lifecycle. The
// composable below wraps this with AbortController / onMounted /
// onUnmounted management.
export async function refreshOnce<T>(
  opts: UseFreshPluginDataOptions<T>,
  signal: AbortSignal,
): Promise<boolean> {
  const result = await apiGet<unknown>(opts.endpoint(), undefined, { signal });
  // AbortError / network error / non-OK HTTP / malformed JSON all land
  // as { ok: false }. The caller still has prop-initialised state as a
  // fallback, so a failed refresh is a silent no-op.
  if (signal.aborted || !result.ok) return false;
  const extracted = opts.extract(result.data);
  if (extracted === null) return false;
  opts.apply(extracted);
  return true;
}

export function useFreshPluginData<T>(
  opts: UseFreshPluginDataOptions<T>,
): UseFreshPluginDataHandle {
  let controller: AbortController | null = null;

  async function refresh(): Promise<boolean> {
    controller?.abort();
    const c = new AbortController();
    controller = c;
    return refreshOnce(opts, c.signal);
  }

  function abort(): void {
    controller?.abort();
    controller = null;
  }

  onMounted(() => {
    void refresh();
  });
  onUnmounted(abort);

  return { refresh, abort };
}
