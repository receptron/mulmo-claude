import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { useClipboardCopy } from "../../src/plugin-vue/index.ts";

// Stub `navigator.clipboard` so the composable can be exercised without jsdom. Tests
// restore the pre-existing `navigator` in afterEach.

interface ClipboardStub {
  writeText: (text: string) => Promise<void>;
}
interface NavigatorStub {
  clipboard: ClipboardStub;
}

// Node exposes `navigator` as a getter-only property from v24+, so a plain assignment
// throws. `Object.defineProperty` overrides that.
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

let clipboardWrites: string[] = [];
let clipboardShouldFail = false;

function installStubNavigator(): void {
  clipboardWrites = [];
  clipboardShouldFail = false;
  const stub: NavigatorStub = {
    clipboard: {
      writeText(text) {
        if (clipboardShouldFail) {
          return Promise.reject(new Error("clipboard blocked"));
        }
        clipboardWrites.push(text);
        return Promise.resolve();
      },
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: stub,
    writable: true,
    configurable: true,
  });
}

function restoreNavigator(): void {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  } else {
    delete (globalThis as { navigator?: unknown }).navigator;
  }
}

describe("useClipboardCopy", () => {
  beforeEach(() => {
    installStubNavigator();
    mock.timers.enable({ apis: ["setTimeout"] });
  });
  afterEach(() => {
    mock.timers.reset();
    restoreNavigator();
  });

  it("writes the text to the clipboard and flips `copied` to true", async () => {
    const { copied, copy } = useClipboardCopy();
    assert.equal(copied.value, false);
    await copy("hello world");
    assert.deepEqual(clipboardWrites, ["hello world"]);
    assert.equal(copied.value, true);
  });

  it("resets `copied` back to false after the default 2s window", async () => {
    const { copied, copy } = useClipboardCopy();
    await copy("x");
    assert.equal(copied.value, true);
    mock.timers.tick(1999);
    assert.equal(copied.value, true);
    mock.timers.tick(1);
    assert.equal(copied.value, false);
  });

  it("honours a custom resetMs argument", async () => {
    const { copied, copy } = useClipboardCopy(500);
    await copy("x");
    mock.timers.tick(499);
    assert.equal(copied.value, true);
    mock.timers.tick(1);
    assert.equal(copied.value, false);
  });

  it("swallows clipboard failures and leaves `copied` false", async () => {
    clipboardShouldFail = true;
    const { copied, copy } = useClipboardCopy();
    await copy("x");
    assert.deepEqual(clipboardWrites, []);
    assert.equal(copied.value, false);
  });

  it("a rapid second copy cancels the first reset and extends the window from the latest call", async () => {
    // Regression for the clearTimeout fix: without it, the first copy's timer fires at
    // t=1000 and clears the hint even though a second copy landed at t=500.
    const { copied, copy } = useClipboardCopy(1000);
    await copy("first");
    mock.timers.tick(500);
    await copy("second");
    mock.timers.tick(500); // t=1000: the first (cancelled) timer would have fired here.
    assert.equal(copied.value, true);
    mock.timers.tick(500); // t=1500: the second copy's timer fires.
    assert.equal(copied.value, false);
  });
});
