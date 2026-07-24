// Unit tests for the shadow-DOM-safe click-target predicate behind the
// collection dropdowns' close-on-outside-click
// (packages/plugins/collection-plugin/src/vue/composables/eventInsideElement.ts).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { eventInsideElement } from "../../../packages/plugins/collection-plugin/src/vue/composables/eventInsideElement";

// The predicate only reads `composedPath()`, so a minimal fake suffices —
// no DOM. `composedPath()` is the retargeted event path (shadow host + light
// DOM ancestors), which is exactly what a document-level listener sees.
function eventWithPath(path: EventTarget[]): Event {
  return { composedPath: () => path } as unknown as Event;
}

function fakeElement(name: string): HTMLElement {
  return { __name: name } as unknown as HTMLElement;
}

describe("eventInsideElement", () => {
  const wrapper = fakeElement("wrapper");
  const inner = fakeElement("inner");
  const root = fakeElement("root");
  const outside = fakeElement("outside");

  it("returns true when the wrapper is on the event's composed path", () => {
    assert.equal(eventInsideElement(eventWithPath([inner, wrapper, root]), wrapper), true);
  });

  it("returns true when the wrapper is the direct target", () => {
    assert.equal(eventInsideElement(eventWithPath([wrapper]), wrapper), true);
  });

  it("returns false when the wrapper is not on the path (outside click)", () => {
    assert.equal(eventInsideElement(eventWithPath([outside, root]), wrapper), false);
  });

  it("returns false for a null element (menu never mounted / already torn down)", () => {
    assert.equal(eventInsideElement(eventWithPath([inner, wrapper]), null), false);
  });

  it("returns false for an empty composed path", () => {
    assert.equal(eventInsideElement(eventWithPath([]), wrapper), false);
  });
});
