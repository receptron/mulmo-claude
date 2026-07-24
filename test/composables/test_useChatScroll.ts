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
//
// Defaults to a container that exactly fits its content (scrollHeight ===
// clientHeight), i.e. already at the bottom — the state the streaming
// regression tests below assume. Pass a taller scrollHeight to model a
// list the reader can actually scroll up inside.
function makeFakeScrollEl(opts: { scrollHeight?: number; clientHeight?: number } = {}) {
  const writes: number[] = [];
  const listeners = new Set<() => void>();
  let scrollTop = 0;
  const element = {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(val: number) {
      scrollTop = val;
      writes.push(val);
    },
    scrollHeight: opts.scrollHeight ?? 1000,
    clientHeight: opts.clientHeight ?? 1000,
    addEventListener: (_type: string, handler: () => void) => {
      listeners.add(handler);
    },
    removeEventListener: (_type: string, handler: () => void) => {
      listeners.delete(handler);
    },
  };
  // Simulate a USER scroll: move the position without recording it as an
  // auto-scroll write, then fire the handler the composable subscribed to.
  const userScrollTo = (top: number): void => {
    scrollTop = top;
    for (const handler of listeners) handler();
  };
  // The composable expects an HTMLDivElement; the fake only needs
  // scrollTop/scrollHeight/clientHeight + listeners, so the cast is safe
  // in test scope.
  return { el: element as unknown as HTMLDivElement, writes, userScrollTo };
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

    await assert.doesNotReject(async () => {
      running.value = true;
      await nextTick();
      running.value = false;
      await nextTick();
    });
    // Assertion is the doesNotReject above — this test's contract is
    // "watchers don't crash on isRunning flip with an empty list".
  });
});

// #2179: streaming fired the watch on every chunk and forced the scroll,
// dragging the view out from under anyone reading further up. Following
// must now yield to the reader and re-arm when they come back.
describe("useChatScroll — sticky bottom (#2179)", () => {
  // A tall list the reader can actually scroll inside: 2000px of content
  // in a 500px viewport, so the bottom is scrollTop === 1500.
  const TALL = { scrollHeight: 2000, clientHeight: 500 };
  const BOTTOM_SCROLL_TOP = TALL.scrollHeight - TALL.clientHeight;

  function setup(sessionId: string) {
    const session = reactive(createEmptySession(sessionId, "general"));
    const { el, writes, userScrollTo } = makeFakeScrollEl(TALL);
    const running = ref(false);
    useChatScroll({
      sessionSidebarRef: ref<{ root: HTMLDivElement | null } | null>({ root: el }),
      toolResults: computed<ToolResultComplete[]>(() => session.toolResults),
      isRunning: computed(() => running.value),
      chatInputRef: ref<{ focus: () => void } | null>(null),
    });
    return { session, writes, userScrollTo, running };
  }

  const stream = async (session: ReturnType<typeof reactive>, text: string) => {
    applyTextEvent(session as never, text, "assistant");
    await nextTick();
    await nextTick();
  };

  it("still follows on load when the fresh container is not yet at the bottom", async () => {
    // A freshly mounted list sits at scrollTop 0 with a full transcript, so by
    // raw geometry it is "not near the bottom" — but the reader has not
    // scrolled anywhere, so the load must still jump to the latest message.
    // Seeding the gate from the mount-time scroll position instead of
    // defaulting to "following" would strand the session at its OLDEST
    // message; only a real scroll event may disarm following.
    const session = reactive(createEmptySession("s7", "general"));
    const { el, writes } = makeFakeScrollEl(TALL);
    useChatScroll({
      sessionSidebarRef: ref<{ root: HTMLDivElement | null } | null>({ root: el }),
      toolResults: computed<ToolResultComplete[]>(() => session.toolResults),
      isRunning: computed(() => false),
      chatInputRef: ref<{ focus: () => void } | null>(null),
    });

    await stream(session, "Hello");

    assert.ok(writes.length >= 1, "a freshly mounted list must still scroll to the latest result");
  });

  it("stops following once the reader scrolls up", async () => {
    const { session, writes, userScrollTo } = setup("s4");

    await stream(session, "Hello");
    assert.ok(writes.length >= 1, "should follow while parked at the bottom");

    userScrollTo(0); // reader scrolls up to re-read
    const writesWhenScrolledUp = writes.length;

    await stream(session, " world");
    await stream(session, "!");

    assert.equal(writes.length, writesWhenScrolledUp, "streaming must not scroll while the reader is scrolled up");
    // The stream itself still lands — only the viewport is left alone.
    assert.equal(session.toolResults[0].message, "Hello world!");
  });

  it("resumes following when the reader returns to the bottom", async () => {
    const { session, writes, userScrollTo } = setup("s5");

    await stream(session, "Hello");
    userScrollTo(0);
    await stream(session, " world");
    const writesWhenScrolledUp = writes.length;

    userScrollTo(BOTTOM_SCROLL_TOP); // back to the bottom → re-arm
    await stream(session, "!");

    assert.ok(writes.length > writesWhenScrolledUp, "following should resume once the reader is back at the bottom");
  });

  it("still jumps to the bottom when a run starts, even if scrolled up", async () => {
    // A run starting means the user just sent something — an explicit
    // action, so it re-arms and forces the jump.
    const { session, writes, userScrollTo, running } = setup("s6");

    await stream(session, "Hello");
    userScrollTo(0);
    const writesWhenScrolledUp = writes.length;

    running.value = true;
    await nextTick();
    await nextTick();

    assert.ok(writes.length > writesWhenScrolledUp, "sending should force a jump to the bottom");

    // …and following is re-armed, so the next chunk keeps up.
    const writesAfterSend = writes.length;
    await stream(session, " again");
    assert.ok(writes.length > writesAfterSend, "following should be re-armed after a send");
  });
});

// The "new messages" affordance (#2181). The badge claims new output arrived,
// so it must not appear merely because the reader scrolled up — someone
// re-reading an old card has no new messages, and saying otherwise is a lie
// the UI can't take back. These pin the distinction.
describe("useChatScroll — new-messages affordance", () => {
  function mountScroll(sessionId: string, scrollEl: HTMLDivElement) {
    const session = reactive(createEmptySession(sessionId, "general"));
    const sessionSidebarRef = ref<{ root: HTMLDivElement | null } | null>({ root: scrollEl });
    const toolResults = computed<ToolResultComplete[]>(() => session.toolResults);
    const isRunning = computed(() => false);
    const chatInputRef = ref<{ focus: () => void } | null>(null);
    const handle = useChatScroll({ sessionSidebarRef, toolResults, isRunning, chatInputRef });
    return { session, handle };
  }

  it("stays false while the reader sits at the bottom", async () => {
    const { el } = makeFakeScrollEl();
    const { session, handle } = mountScroll("n1", el);

    pushResult(session, makeTextResult("Hello", "assistant"));
    await nextTick();
    await nextTick();

    assert.equal(handle.hasNewWhileDetached.value, false, "following the stream is not 'new messages'");
  });

  it("stays false when the reader scrolls up and nothing new arrives", async () => {
    // The condition the issue proposed (`!stuck`) would flip to true here.
    const { el, userScrollTo } = makeFakeScrollEl({ scrollHeight: 5000, clientHeight: 1000 });
    const { handle } = mountScroll("n2", el);

    userScrollTo(0);
    await nextTick();

    assert.equal(handle.stuckToBottom.value, false, "scrolling up detaches");
    assert.equal(handle.hasNewWhileDetached.value, false, "detached alone must not claim new messages");
  });

  it("turns true when output arrives while detached", async () => {
    const { el, userScrollTo } = makeFakeScrollEl({ scrollHeight: 5000, clientHeight: 1000 });
    const { session, handle } = mountScroll("n3", el);

    userScrollTo(0);
    await nextTick();
    pushResult(session, makeTextResult("While you were away", "assistant"));
    await nextTick();
    await nextTick();

    assert.equal(handle.hasNewWhileDetached.value, true);
  });

  it("does not fire when switching sessions while detached", async () => {
    // Regression (Codex review on #2291): the watched key is derived from the
    // last result, so swapping the whole list on a session switch changes it
    // too. Treating that as "output arrived" is the exact false positive this
    // affordance exists to avoid — the other session's backlog is not news.
    const { el, userScrollTo } = makeFakeScrollEl({ scrollHeight: 5000, clientHeight: 1000 });
    const sessionA = reactive(createEmptySession("swap-a", "general"));
    const sessionB = reactive(createEmptySession("swap-b", "general"));
    pushResult(sessionA, makeTextResult("from A", "assistant"));
    pushResult(sessionB, makeTextResult("from B", "assistant"));

    const active = ref<typeof sessionA>(sessionA);
    const handle = useChatScroll({
      sessionSidebarRef: ref<{ root: HTMLDivElement | null } | null>({ root: el }),
      toolResults: computed<ToolResultComplete[]>(() => active.value.toolResults),
      isRunning: computed(() => false),
      chatInputRef: ref<{ focus: () => void } | null>(null),
      sessionId: computed(() => active.value.id),
    });

    userScrollTo(0);
    await nextTick();
    assert.equal(handle.stuckToBottom.value, false, "reader is detached");

    active.value = sessionB;
    await nextTick();
    await nextTick();

    assert.equal(handle.hasNewWhileDetached.value, false, "a session switch is not new output");
  });

  it("clears once following is re-armed by jumpToLatest", async () => {
    const { el, userScrollTo, writes } = makeFakeScrollEl({ scrollHeight: 5000, clientHeight: 1000 });
    const { session, handle } = mountScroll("n4", el);

    userScrollTo(0);
    await nextTick();
    pushResult(session, makeTextResult("While you were away", "assistant"));
    await nextTick();
    await nextTick();
    assert.equal(handle.hasNewWhileDetached.value, true);

    handle.jumpToLatest();
    await nextTick();
    await nextTick();

    assert.equal(handle.stuckToBottom.value, true, "jumpToLatest re-arms following");
    assert.equal(handle.hasNewWhileDetached.value, false, "and retires the badge");
    // Re-arming is only half of it — the user pressed a button that says
    // "jump", so the list must actually be at the bottom (CodeRabbit on #2291).
    assert.equal(writes[writes.length - 1], 5000, "jumpToLatest scrolls to the bottom");
  });
});
