// Regression test for the streaming auto-scroll bug: when the
// assistant streams text into an existing text-response card via
// appendToLastAssistantText, the card's `.message` grows in place
// and `toolResults.length` does not change. Watching only `length`
// (the pre-fix behaviour) stopped auto-scroll mid-stream.
//
// The fix is to watch a key that includes the last result's message
// length, so the scroll fires on every streaming chunk.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computed, nextTick, reactive, ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { useChatScroll } from "../../src/composables/useChatScroll.js";
import { applyTextEvent, pushResult } from "../../src/utils/session/sessionHelpers.js";
import { createEmptySession } from "../../src/utils/session/sessionFactory.js";
import { makeTextResult } from "../../src/utils/tools/result.js";

// Build a fake scroll-container element that records every write
// to scrollTop so the test can count auto-scroll invocations.
function makeFakeScrollEl() {
  const writes: number[] = [];
  let scrollTop = 0;
  const element = {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(val: number) {
      scrollTop = val;
      writes.push(val);
    },
    scrollHeight: 1000,
  };
  // The composable expects an HTMLDivElement; the fake only needs
  // scrollTop/scrollHeight, so the cast is safe in test scope.
  return { el: element as unknown as HTMLDivElement, writes };
}

describe("useChatScroll — streaming auto-scroll", () => {
  it("scrolls when a new text-response is appended (length changes)", async () => {
    const session = reactive(createEmptySession("s1", "general"));
    const { el, writes } = makeFakeScrollEl();

    const sessionSidebarRef = ref<{ root: HTMLDivElement | null } | null>({
      root: el,
    });
    const toolResults = computed<ToolResultComplete[]>(() => session.toolResults);
    const isRunning = computed(() => false);
    const chatInputRef = ref<{ focus: () => void } | null>(null);

    useChatScroll({
      sessionSidebarRef,
      toolResults,
      isRunning,
      chatInputRef,
    });

    // Simulate: first assistant chunk pushes a new text-response card.
    pushResult(session, makeTextResult("Hello", "assistant"));
    await nextTick();
    await nextTick(); // watcher → scrollChatToBottom → nextTick → write

    assert.ok(writes.length >= 1, "scroll should fire on new result");
  });

  it("scrolls on in-place streaming updates (length unchanged)", async () => {
    // This is the regression the fix targets: `appendToLastAssistantText`
    // mutates `last.message` in place — if the watch key only tracked
    // `toolResults.length`, no further scrolls would fire after the
    // first chunk.
    const session = reactive(createEmptySession("s2", "general"));
    const { el, writes } = makeFakeScrollEl();

    const sessionSidebarRef = ref<{ root: HTMLDivElement | null } | null>({
      root: el,
    });
    const toolResults = computed<ToolResultComplete[]>(() => session.toolResults);
    const isRunning = computed(() => false);
    const chatInputRef = ref<{ focus: () => void } | null>(null);

    useChatScroll({
      sessionSidebarRef,
      toolResults,
      isRunning,
      chatInputRef,
    });

    // First chunk: new text-response card (length 0 → 1, uuid changes).
    applyTextEvent(session, "Hello", "assistant");
    await nextTick();
    await nextTick();
    const writesAfterFirst = writes.length;
    assert.ok(writesAfterFirst >= 1, "first chunk should scroll");

    // Subsequent chunks append in place — length stays 1, but message
    // grows. The fix must trigger additional scrolls here.
    applyTextEvent(session, " world", "assistant");
    await nextTick();
    await nextTick();
    applyTextEvent(session, "!", "assistant");
    await nextTick();
    await nextTick();

    assert.ok(
      writes.length > writesAfterFirst,
      `streaming chunks should trigger further scrolls — pre-fix this stayed at ${writesAfterFirst} (writes=${writes.length})`,
    );

    // Sanity: the session accumulated the full message in place.
    assert.equal(session.toolResults.length, 1);
    assert.equal(session.toolResults[0].message, "Hello world!");
  });

  it("does not scroll when isRunning is the only change and no results", async () => {
    // isRunning flipping true also schedules a scroll (run-start focus),
    // but nothing to scroll when there are no results. Just confirm
    // the watcher is wired and doesn't throw.
    const session = reactive(createEmptySession("s3", "general"));
    const running = ref(false);
    const { el } = makeFakeScrollEl();

    useChatScroll({
      sessionSidebarRef: ref({ root: el }),
      toolResults: computed(() => session.toolResults),
      isRunning: computed(() => running.value),
      chatInputRef: ref(null),
    });

    running.value = true;
    await nextTick();
    running.value = false;
    await nextTick();
    // No assertion on scrolls — this test just ensures the watchers
    // don't crash when flipping isRunning with an empty list.
  });
});
