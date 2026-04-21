// Debug beat indicator — toggles the app title color when the server
// emits debug-beat events via pub/sub. Only active in --debug mode.

import { ref, computed, type CSSProperties } from "vue";
import { usePubSub } from "./usePubSub";
import { PUBSUB_CHANNELS } from "../config/pubsubChannels";

export function useDebugBeat() {
  const debugBeatColor = ref<string | null>(null);
  const debugTitleStyle = computed<CSSProperties>(() =>
    debugBeatColor.value ? { color: debugBeatColor.value } : {},
  );

  const { subscribe } = usePubSub();
  subscribe(PUBSUB_CHANNELS.debugBeat, (data) => {
    const msg = data as { count: number; last?: boolean };
    if (msg.last) {
      debugBeatColor.value = null;
    } else {
      debugBeatColor.value = msg.count % 2 === 0 ? "#3b82f6" : "#ef4444";
    }
  });

  return { debugTitleStyle };
}
