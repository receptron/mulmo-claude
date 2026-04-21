import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { findScrollableChild } from "../../../src/utils/dom/scrollable.js";

// findScrollableChild touches DOM APIs (querySelectorAll, scrollHeight,
// clientHeight, getComputedStyle). Rather than spin up jsdom, we mock
// just enough of the HTMLElement interface to drive the function.

interface MockElement {
  scrollHeight: number;
  clientHeight: number;
  overflowY?: string;
  overflow?: string;
}

// Saved before the first stub so each test's afterEach can put the
// real implementation (or undefined) back. Without this the stub
// would leak into any subsequent test file run in the same process.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalGetComputedStyle: any =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).getComputedStyle;

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).getComputedStyle = originalGetComputedStyle;
});

function fakeContainer(children: MockElement[]) {
  const elements = children.map(
    (c) =>
      ({
        scrollHeight: c.scrollHeight,
        clientHeight: c.clientHeight,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  );

  // Stub getComputedStyle on globalThis so the function under test
  // sees the overflow we configured per fake child. The afterEach
  // hook above restores the original implementation.
  const styles = new Map<unknown, { overflow: string; overflowY: string }>();
  children.forEach((c, i) => {
    styles.set(elements[i], {
      overflowY: c.overflowY ?? "visible",
      overflow: c.overflow ?? "visible",
    });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).getComputedStyle = (el: unknown): { overflow: string; overflowY: string } =>
    styles.get(el) ?? { overflow: "visible", overflowY: "visible" };

  return {
    querySelectorAll: () => elements,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("findScrollableChild", () => {
  it("returns null when no descendant overflows", () => {
    const c = fakeContainer([
      { scrollHeight: 100, clientHeight: 100 },
      { scrollHeight: 50, clientHeight: 200 },
    ]);
    assert.equal(findScrollableChild(c), null);
  });

  it("returns null when a descendant overflows but has visible overflow", () => {
    const c = fakeContainer([{ scrollHeight: 500, clientHeight: 100, overflow: "visible" }]);
    assert.equal(findScrollableChild(c), null);
  });

  it("returns the first descendant that overflows AND is overflow-y: auto", () => {
    const c = fakeContainer([
      { scrollHeight: 100, clientHeight: 100 }, // not scrollable
      { scrollHeight: 500, clientHeight: 100, overflowY: "auto" }, // ✓
      { scrollHeight: 500, clientHeight: 100, overflowY: "scroll" }, // also ✓ but later
    ]);
    const found = findScrollableChild(c);
    assert.ok(found);
    assert.equal(found?.scrollHeight, 500);
  });

  it("recognizes overflow: scroll on the shorthand property", () => {
    const c = fakeContainer([{ scrollHeight: 500, clientHeight: 100, overflow: "scroll" }]);
    const found = findScrollableChild(c);
    assert.ok(found);
  });

  it("recognizes overflow-y: scroll", () => {
    const c = fakeContainer([{ scrollHeight: 500, clientHeight: 100, overflowY: "scroll" }]);
    const found = findScrollableChild(c);
    assert.ok(found);
  });
});
