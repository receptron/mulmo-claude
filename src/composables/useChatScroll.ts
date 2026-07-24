// Auto-scroll the sidebar chat list to the bottom when new results
// arrive or a run starts. Also re-focuses the chat input when a run
// finishes.
//
// Following is gated on the reader still being at the bottom: streaming
// appends fire this watch on every chunk, and forcing the scroll each
// time dragged the view out from under anyone who had scrolled up to
// read (#2179). A run starting is treated as an explicit user action
// (they just sent something), so that one re-arms and jumps.

import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { useStickToBottom } from "./useStickToBottom";

/** Whether the "new messages" badge should be showing after the result list
 *  changed. Pure so the three cases it has to keep apart stay testable:
 *  output appended while detached (news), the list swapped for another
 *  session's (not news, and the previous session's badge doesn't carry over),
 *  and output arriving while the reader is following (nothing to announce). */
export function nextBadgeState(input: { previous: boolean; switchedSession: boolean; detached: boolean }): boolean {
  if (input.switchedSession) return false;
  return input.detached ? true : input.previous;
}

/** Changes both on new results AND on streaming updates to the last text card
 *  (which appends in place, leaving length stable). The session id leads so a
 *  reader of the key can tell "output was appended" from "the whole list was
 *  swapped for another session's" — both change the tail, only one is news. */
export function scrollKey(sessionId: string | null, list: ToolResultComplete[]): string {
  const last = list[list.length - 1];
  return `${sessionId ?? ""}|${list.length}:${last?.uuid ?? ""}:${last?.message?.length ?? 0}`;
}

const sessionOfKey = (key: string): string => key.slice(0, key.indexOf("|"));

export function useChatScroll<T extends { focus: () => void }>(opts: {
  sessionSidebarRef: Ref<{ root: HTMLDivElement | null } | null>;
  toolResults: ComputedRef<ToolResultComplete[]>;
  isRunning: ComputedRef<boolean>;
  chatInputRef: Ref<T | null>;
  /** Id of the session the list currently shows. Used only to tell a session
   *  switch apart from an append — omit it and both look identical. */
  sessionId?: ComputedRef<string | null>;
}) {
  const { sessionSidebarRef, toolResults, isRunning, chatInputRef, sessionId } = opts;

  const chatListRef = computed(() => sessionSidebarRef.value?.root ?? null);
  const { stuck, resume } = useStickToBottom(chatListRef);
  const latestResultScrollKey = computed(() => scrollKey(sessionId?.value ?? null, toolResults.value));

  function scrollChatToBottom(options: { force?: boolean } = {}): void {
    if (!options.force && !stuck.value) return;
    // Scrolling after the DOM settles is the whole point; callers are sync and
    // have nothing to do with the tick's completion.
    void nextTick(() => {
      if (chatListRef.value) {
        chatListRef.value.scrollTop = chatListRef.value.scrollHeight;
      }
    });
  }

  function focusChatInput(): void {
    chatInputRef.value?.focus();
  }

  // See `nextBadgeState` for why `stuck` alone can't drive this.
  const hasNewWhileDetached = ref(false);

  watch(latestResultScrollKey, (next, previous) => {
    hasNewWhileDetached.value = nextBadgeState({
      previous: hasNewWhileDetached.value,
      switchedSession: sessionOfKey(next) !== sessionOfKey(previous),
      detached: !stuck.value,
    });
    scrollChatToBottom();
  });
  watch(stuck, (isStuck) => {
    if (isStuck) hasNewWhileDetached.value = false;
  });
  watch(isRunning, (running) => {
    if (running) {
      resume();
      scrollChatToBottom({ force: true });
    } else {
      void nextTick(() => focusChatInput());
    }
  });

  /** Jump to the newest output and re-arm following. Bound to the "new
   *  messages" affordance — the reader scrolled away, so `scrollChatToBottom`
   *  alone would no-op on the `stuck` gate; resume first, then force. */
  function jumpToLatest(): void {
    resume();
    scrollChatToBottom({ force: true });
  }

  return { scrollChatToBottom, focusChatInput, jumpToLatest, stuckToBottom: stuck, hasNewWhileDetached };
}
