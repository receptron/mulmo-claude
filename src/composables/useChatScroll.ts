// Auto-scroll the sidebar chat list to the bottom when new results
// arrive or a run starts. Also re-focuses the chat input when a run
// finishes.

import { nextTick, watch, type ComputedRef } from "vue";

export function useChatScroll(opts: {
  chatListRef: ComputedRef<HTMLDivElement | null>;
  toolResultsLength: ComputedRef<number>;
  isRunning: ComputedRef<boolean>;
  focusChatInput: () => void;
}) {
  const { chatListRef, toolResultsLength, isRunning, focusChatInput } = opts;

  function scrollChatToBottom(): void {
    nextTick(() => {
      if (chatListRef.value) {
        chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
      }
    });
  }

  watch(toolResultsLength, scrollChatToBottom);
  watch(isRunning, (running) => {
    if (running) {
      scrollChatToBottom();
    } else {
      nextTick(() => focusChatInput());
    }
  });

  return { scrollChatToBottom };
}
