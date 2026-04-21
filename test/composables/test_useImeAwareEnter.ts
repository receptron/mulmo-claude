import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useImeAwareEnter, SAFARI_IME_RACE_WINDOW_MS } from "../../src/composables/useImeAwareEnter.ts";

// Minimal KeyboardEvent stub so tests can run under node:test without
// jsdom. Only the surface the composable touches is modelled.
interface TestKeyboardEvent {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  preventDefault: () => void;
  defaultPrevented: boolean;
}

function fakeKeydown(opts: { key: string; shiftKey?: boolean; isComposing?: boolean }): TestKeyboardEvent {
  const evt: TestKeyboardEvent = {
    key: opts.key,
    shiftKey: opts.shiftKey ?? false,
    isComposing: opts.isComposing ?? false,
    defaultPrevented: false,
    preventDefault() {
      evt.defaultPrevented = true;
    },
  };
  return evt;
}

function setup() {
  let nowValue = 1_000_000;
  const sends: number[] = [];
  const handlers = useImeAwareEnter(
    () => {
      sends.push(nowValue);
    },
    () => nowValue,
  );
  return {
    handlers,
    sends,
    advance(ms: number) {
      nowValue += ms;
    },
    now() {
      return nowValue;
    },
  };
}

describe("useImeAwareEnter", () => {
  it("plain Enter sends and prevents default newline", () => {
    const { handlers, sends } = setup();
    const keyEvent = fakeKeydown({ key: "Enter" });
    handlers.onKeydown(keyEvent as unknown as KeyboardEvent);
    assert.equal(sends.length, 1);
    assert.equal(keyEvent.defaultPrevented, true);
  });

  it("Shift+Enter does not send and allows default newline", () => {
    const { handlers, sends } = setup();
    const keyEvent = fakeKeydown({ key: "Enter", shiftKey: true });
    handlers.onKeydown(keyEvent as unknown as KeyboardEvent);
    assert.equal(sends.length, 0);
    assert.equal(keyEvent.defaultPrevented, false);
  });

  it("non-Enter keys are ignored", () => {
    const { handlers, sends } = setup();
    const keyEvent = fakeKeydown({ key: "a" });
    handlers.onKeydown(keyEvent as unknown as KeyboardEvent);
    assert.equal(sends.length, 0);
    assert.equal(keyEvent.defaultPrevented, false);
  });

  it("Chrome-order: keydown with isComposing=true does not send", () => {
    // Chrome fires keydown BEFORE compositionend; isComposing is still
    // true on the confirming Enter, so the event tells us directly.
    const { handlers, sends } = setup();
    handlers.onCompositionStart();
    const confirm = fakeKeydown({ key: "Enter", isComposing: true });
    handlers.onKeydown(confirm as unknown as KeyboardEvent);
    assert.equal(sends.length, 0);
    assert.equal(confirm.defaultPrevented, true);
    handlers.onCompositionEnd();
  });

  it("Chrome-order: a later send Enter after composition goes through", () => {
    const { handlers, sends, advance } = setup();
    handlers.onCompositionStart();
    const confirm = fakeKeydown({ key: "Enter", isComposing: true });
    handlers.onKeydown(confirm as unknown as KeyboardEvent);
    handlers.onCompositionEnd();
    // User's intentional follow-up Enter is well outside the race
    // window — >= 100ms is a realistic human reaction time.
    advance(100);
    const send = fakeKeydown({ key: "Enter" });
    handlers.onKeydown(send as unknown as KeyboardEvent);
    assert.equal(sends.length, 1);
    assert.equal(send.defaultPrevented, true);
  });

  it("Safari-order: compositionend then keydown within window does not send", () => {
    // Safari fires compositionend BEFORE the confirming Enter keydown,
    // synchronously (microseconds). The race window catches it.
    const { handlers, sends, advance } = setup();
    handlers.onCompositionStart();
    handlers.onCompositionEnd();
    advance(1); // synchronous micro-delay
    const confirm = fakeKeydown({ key: "Enter", isComposing: false });
    handlers.onKeydown(confirm as unknown as KeyboardEvent);
    assert.equal(sends.length, 0);
    assert.equal(confirm.defaultPrevented, true);
  });

  it("Safari-order: Enter past the race window sends normally", () => {
    const { handlers, sends, advance } = setup();
    handlers.onCompositionStart();
    handlers.onCompositionEnd();
    advance(SAFARI_IME_RACE_WINDOW_MS);
    const send = fakeKeydown({ key: "Enter" });
    handlers.onKeydown(send as unknown as KeyboardEvent);
    assert.equal(sends.length, 1);
  });

  it("isImeComposing flag blocks Enter when browser omits isComposing", () => {
    // Defence in depth: even if a browser fires a keydown during
    // composition without isComposing=true, our internal flag catches it.
    const { handlers, sends } = setup();
    handlers.onCompositionStart();
    const keyEvent = fakeKeydown({ key: "Enter", isComposing: false });
    handlers.onKeydown(keyEvent as unknown as KeyboardEvent);
    assert.equal(sends.length, 0);
    assert.equal(keyEvent.defaultPrevented, true);
  });

  it("onBlur clears state so a stale composition doesn't wedge the textarea", () => {
    const { handlers, sends } = setup();
    handlers.onCompositionStart();
    handlers.onBlur();
    const keyEvent = fakeKeydown({ key: "Enter" });
    handlers.onKeydown(keyEvent as unknown as KeyboardEvent);
    assert.equal(sends.length, 1);
  });

  it("onBlur also clears the race-window timestamp", () => {
    const { handlers, sends } = setup();
    handlers.onCompositionStart();
    handlers.onCompositionEnd();
    handlers.onBlur();
    // If the timestamp weren't cleared, this Enter would still be
    // within the race window and get suppressed.
    const keyEvent = fakeKeydown({ key: "Enter" });
    handlers.onKeydown(keyEvent as unknown as KeyboardEvent);
    assert.equal(sends.length, 1);
  });
});
