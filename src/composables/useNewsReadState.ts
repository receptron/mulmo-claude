// Composable: own the news viewer's per-item read flags. The server
// persists the list as `config/news-read-state.json`; the composable
// keeps a `Set<string>` for O(1) lookup and a queue of pending writes
// so a fast click sequence doesn't pile up overlapping PUTs.

import { ref, computed } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPut } from "../utils/api";

export function useNewsReadState() {
  const readIds = ref(new Set<string>());
  const error = ref<string | null>(null);

  // Single in-flight chain — successive markRead / markAllRead calls
  // queue rather than overlap. Keeps the server's view consistent
  // with the most recent intent.
  let inflight: Promise<unknown> = Promise.resolve();

  async function load(): Promise<void> {
    const result = await apiGet<{ readIds: string[] }>(API_ROUTES.news.readState);
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    error.value = null;
    readIds.value = new Set(result.data.readIds);
  }

  async function persist(): Promise<void> {
    const snapshot = Array.from(readIds.value);
    const task = inflight
      .catch(() => undefined)
      .then(async () => {
        const result = await apiPut<{ readIds: string[] }>(API_ROUTES.news.readState, { readIds: snapshot });
        if (!result.ok) {
          error.value = result.error;
          return;
        }
        error.value = null;
        // Reflect the server's sanitized list so dedupe / cap come back.
        readIds.value = new Set(result.data.readIds);
      });
    inflight = task;
    return task;
  }

  function markRead(itemId: string): void {
    if (readIds.value.has(itemId)) return;
    readIds.value.add(itemId);
    // Trigger reactivity — `Set` mutation isn't reactive on its own.
    readIds.value = new Set(readIds.value);
    void persist();
  }

  function markAllRead(allIds: readonly string[]): void {
    let changed = false;
    for (const itemId of allIds) {
      if (!readIds.value.has(itemId)) {
        readIds.value.add(itemId);
        changed = true;
      }
    }
    if (!changed) return;
    readIds.value = new Set(readIds.value);
    void persist();
  }

  function isRead(itemId: string): boolean {
    return readIds.value.has(itemId);
  }

  const readCount = computed(() => readIds.value.size);

  return { readIds, error, load, markRead, markAllRead, isRead, readCount };
}
