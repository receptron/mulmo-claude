import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PRIORITIES, PRIORITY_LABELS, isPriority } from "../../../src/plugins/todo/priority.js";

describe("isPriority", () => {
  it("accepts every value in PRIORITIES", () => {
    for (const priority of PRIORITIES) {
      assert.equal(isPriority(priority), true);
    }
  });

  it("rejects non-string inputs", () => {
    assert.equal(isPriority(undefined), false);
    assert.equal(isPriority(null), false);
    assert.equal(isPriority(0), false);
    assert.equal(isPriority({}), false);
    assert.equal(isPriority([]), false);
  });

  it("rejects unknown strings", () => {
    assert.equal(isPriority("huge"), false);
    assert.equal(isPriority(""), false);
    assert.equal(isPriority("LOW"), false);
  });

  it("rejects inherited Object.prototype keys (regression)", () => {
    // The previous implementation used the `in` operator which walks
    // the prototype chain. That meant `"toString" in PRIORITY_ORDER`
    // returned true and isPriority falsely accepted built-in
    // Object.prototype keys. The fix uses Object.prototype.hasOwnProperty
    // .call so only own properties qualify.
    assert.equal(isPriority("toString"), false);
    assert.equal(isPriority("hasOwnProperty"), false);
    assert.equal(isPriority("constructor"), false);
    assert.equal(isPriority("valueOf"), false);
  });
});

describe("PRIORITY_LABELS", () => {
  it("has a label for every priority", () => {
    for (const priority of PRIORITIES) {
      assert.equal(typeof PRIORITY_LABELS[priority], "string");
      assert.ok(PRIORITY_LABELS[priority].length > 0);
    }
  });
});
