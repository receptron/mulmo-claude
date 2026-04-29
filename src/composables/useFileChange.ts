// Subscribe to per-file change events from the server pub/sub.
//
// Returns a `version` ref that bumps to the post-write `mtimeMs`
// every time the file at the given path is rewritten anywhere — same
// tab, sibling tab, another browser, agent loop. View components use
// this both as a cache-buster (`<iframe :src="url + '?v=' + version">`)
// and as a watch trigger (refetch source / re-render markdown).
//
// `filePath` is reactive: switching `selectedResult` flips it, the
// composable unsubscribes from the old channel and subscribes to the
// new one. `version` resets to 0 whenever the path changes so callers
// can cheaply detect "this file has been modified since I started
// watching it" via `version.value > 0`.

import { ref, watch, onUnmounted, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { fileChannel, type FileChannelPayload } from "../config/pubsubChannels";

export interface UseFileChangeReturn {
  /** Latest known `mtimeMs` from the server, or `0` while we have not
   *  observed a change since the path was set. Monotonic per path. */
  version: Ref<number>;
}

export function useFileChange(filePath: Ref<string | null>): UseFileChangeReturn {
  const version = ref(0);
  const { subscribe } = usePubSub();
  let unsubscribe: (() => void) | null = null;

  function bind(nextPath: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    version.value = 0;
    if (!nextPath) return;
    unsubscribe = subscribe(fileChannel(nextPath), (data) => {
      const event = data as FileChannelPayload;
      // Drop out-of-order events. Two writers landing within the same
      // millisecond would also collapse to the later mtime, but that's
      // fine — we'd refetch once and observe the merged state.
      if (typeof event?.mtimeMs === "number" && event.mtimeMs > version.value) {
        version.value = event.mtimeMs;
      }
    });
  }

  watch(filePath, bind, { immediate: true });
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return { version };
}
