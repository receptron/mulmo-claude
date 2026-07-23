// Per-file change subscription over the host-agnostic runtime pubsub, shared by
// the html and markdown plugin Views (a plugin can't import another plugin, so
// this lives in core). It subscribes to the plugin-scoped `file:<path>` channel
// (resolves to `plugin:<pkg>:file:<path>`) and bumps a monotonic `version` ref on
// each `{ mtimeMs }` event. The host forwards its workspace file-change events
// onto that channel; if it doesn't, live-refresh simply never fires (self-saves
// already update local state optimistically).

import { ref, watch, onUnmounted, type Ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { fileWatchChannel, nextFileVersion } from "./fileWatch.ts";

// The one seam that differs between pubsub substrates: how to subscribe to
// change events for a path. Plugin Views use the runtime pubsub (below); the
// host's `useFileChange` passes its socket-based `usePubSub` + `fileChannel`.
export type SubscribeToFile = (filePath: string, onData: (data: unknown) => void) => () => void;

interface ActiveSubscription {
  unsubscribe: (() => void) | null;
}

// Scaffold shared by `useFileWatch` and the host's `useFileChange`: rebind on
// path change, reset `version` to 0, bump it via `nextFileVersion` on each
// event, tear down on unmount.
export function useFileVersion(filePath: Ref<string | null>, subscribeToFile: SubscribeToFile): { version: Ref<number> } {
  const version = ref(0);
  const active: ActiveSubscription = { unsubscribe: null };

  function bind(nextPath: string | null): void {
    active.unsubscribe?.();
    active.unsubscribe = null;
    version.value = 0;
    if (!nextPath) return;
    active.unsubscribe = subscribeToFile(nextPath, (data) => {
      version.value = nextFileVersion(version.value, data);
    });
  }

  watch(filePath, bind, { immediate: true });
  onUnmounted(() => {
    active.unsubscribe?.();
    active.unsubscribe = null;
  });

  return { version };
}

export function useFileWatch(filePath: Ref<string | null>): { version: Ref<number> } {
  const { pubsub } = useRuntime();
  return useFileVersion(filePath, (path, onData) => pubsub.subscribe(fileWatchChannel(path), onData));
}
