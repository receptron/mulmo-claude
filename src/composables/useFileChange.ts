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
//
// The rebind / version-bump scaffold is `useFileVersion` from core —
// only the pubsub substrate differs (host-local `usePubSub` +
// `fileChannel` here, the `gui-chat-protocol/vue` runtime in plugins),
// so that seam is what this composable injects.

import type { Ref } from "vue";
import { useFileVersion } from "@mulmoclaude/core/plugin-vue";
import { usePubSub } from "./usePubSub";
import { fileChannel } from "../config/pubsubChannels";

export interface UseFileChangeReturn {
  /** Latest known `mtimeMs` from the server, or `0` while we have not
   *  observed a change since the path was set. Monotonic per path. */
  version: Ref<number>;
}

export function useFileChange(filePath: Ref<string | null>): UseFileChangeReturn {
  const { subscribe } = usePubSub();
  return useFileVersion(filePath, (path, onData) => subscribe(fileChannel(path), onData));
}
