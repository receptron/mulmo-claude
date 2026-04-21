import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isClickOutside } from "../../../src/utils/dom/clickOutside.js";

// Minimal Element-shaped fakes. The function only needs `contains`.
function fakeEl(name: string, descendants: Node[] = []): HTMLElement {
  const element = {
    __name: name,
    contains: (node: Node | null) => {
      if (!node) return false;
      if (node === (element as unknown as Node)) return true;
      return descendants.includes(node);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return element as HTMLElement;
}

function fakeNode(name: string): Node {
  return { __name: name } as unknown as Node;
}

describe("isClickOutside", () => {
  const button = fakeEl("button");
  const popup = fakeEl("popup");
  const buttonChild = fakeNode("button-child");
  const popupChild = fakeNode("popup-child");
  const outside = fakeNode("outside");

  // Re-fake with descendants now that we have the children
  const buttonWithChild = fakeEl("button", [buttonChild]);
  const popupWithChild = fakeEl("popup", [popupChild]);

  it("returns false when target is null", () => {
    assert.equal(isClickOutside(null, button, popup), false);
  });

  it("returns false when target is the button itself", () => {
    assert.equal(isClickOutside(button as unknown as Node, button, popup), false);
  });

  it("returns false when target is the popup itself", () => {
    assert.equal(isClickOutside(popup as unknown as Node, button, popup), false);
  });

  it("returns false when target is inside the button subtree", () => {
    assert.equal(isClickOutside(buttonChild, buttonWithChild, popupWithChild), false);
  });

  it("returns false when target is inside the popup subtree", () => {
    assert.equal(isClickOutside(popupChild, buttonWithChild, popupWithChild), false);
  });

  it("returns true when target is in neither", () => {
    assert.equal(isClickOutside(outside, buttonWithChild, popupWithChild), true);
  });

  it("returns true when both refs are null and target is anywhere", () => {
    assert.equal(isClickOutside(outside, null, null), true);
  });

  it("returns true when only the button ref is set and target is elsewhere", () => {
    assert.equal(isClickOutside(outside, buttonWithChild, null), true);
  });

  it("returns false when only the popup ref is set and target is inside the popup", () => {
    assert.equal(isClickOutside(popupChild, null, popupWithChild), false);
  });
});
