// Auto-scroll the sidebar chat list to the bottom when new results
// arrive or a run starts. Also re-focuses the chat input when a run
// finishes.

import { computed, nextTick, watch, type ComputedRef, type Ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

export function useChatScroll(opts: {
  toolResultsPanelRef: Ref<{ root: HTMLDivElement | null } | null>;
  toolResults: ComputedRef<ToolResultComplete[]>;
  isRunning: ComputedRef<boolean>;
  chatInputRef: Ref<{ focus: () => void } | null>;
}) {
  const { toolResultsPanelRef, toolResults, isRunning, chatInputRef } = opts;

  const chatListRef = computed(() => toolResultsPanelRef.value?.root ?? null);
  // Key that changes both on new results AND on streaming updates to
  // the last text card (which appends in place, leaving length stable).
  const latestResultScrollKey = computed(() => {
    const list = toolResults.value;
    const last = list[list.length - 1];
    return `${list.length}:${last?.uuid ?? ""}:${last?.message?.length ?? 0}`;
  });

  function scrollChatToBottom(): void {
    nextTick(() => {
      if (chatListRef.value) {
        chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
      }
    });
  }

  function focusChatInput(): void {
    chatInputRef.value?.focus();
  }

  watch(latestResultScrollKey, scrollChatToBottom);
  watch(isRunning, (running) => {
    if (running) {
      scrollChatToBottom();
    } else {
      nextTick(() => focusChatInput());
    }
  });

  return { scrollChatToBottom, focusChatInput };
}
