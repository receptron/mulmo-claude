// endpoint() is a function (not a string) so callers can derive the URL from local refs — wiki/View flips between
// /api/wiki and /api/wiki?slug=… depending on action. extract() returns null to skip apply (malformed or
// caller-ignored payload). apply() callers can guard — wiki/Preview only applies the index payload when showing the
// index view, since the preview component is reused for page / log / lint_report previews.

import { onMounted, onUnmounted } from "vue";
import { apiGet } from "../utils/api";

export interface UseFreshPluginDataOptions<T> {
  endpoint: () => string;
  extract: (json: unknown) => T | null;
  apply: (data: T) => void;
}

export interface UseFreshPluginDataHandle {
  // Returns true if the response was applied; false on abort / non-OK / malformed / apply-skipped.
  refresh: () => Promise<boolean>;
  abort: () => void;
}

export async function refreshOnce<T>(opts: UseFreshPluginDataOptions<T>, signal: AbortSignal): Promise<boolean> {
  const result = await apiGet<unknown>(opts.endpoint(), undefined, { signal });
  // Failed refresh is a silent no-op: prop-initialised state stands in. apiGet collapses every failure into ok:false.
  if (signal.aborted || !result.ok) return false;
  const extracted = opts.extract(result.data);
  if (extracted === null) return false;
  opts.apply(extracted);
  return true;
}

export function useFreshPluginData<T>(opts: UseFreshPluginDataOptions<T>): UseFreshPluginDataHandle {
  let controller: AbortController | null = null;

  async function refresh(): Promise<boolean> {
    controller?.abort();
    const ctrl = new AbortController();
    controller = ctrl;
    return refreshOnce(opts, ctrl.signal);
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
