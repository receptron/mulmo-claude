// Own-property guard used by ref/embed resolution (#2322): a dangling id
// that is a prototype key must read as absent, not as an inherited member.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ownProp } from "../../src/collection/core/ownProp.ts";

test("ownProp returns the value for a normal own key", () => {
  assert.equal(ownProp({ aapl: 200 }, "aapl"), 200);
});

test("ownProp returns undefined for a missing key", () => {
  assert.equal(ownProp({ aapl: 200 } as Record<string, number>, "msft"), undefined);
});

test("ownProp returns undefined for prototype keys (not the inherited member)", () => {
  const empty: Record<string, unknown> = {};
  for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(ownProp(empty, key), undefined, `expected ${key} to be absent`);
  }
});

test("ownProp still resolves an own key that shadows a prototype member", () => {
  const withOwn: Record<string, number> = { constructor: 1, toString: 2 };
  assert.equal(ownProp(withOwn, "constructor"), 1);
  assert.equal(ownProp(withOwn, "toString"), 2);
});

test("ownProp resolves an own key whose value is falsy", () => {
  assert.equal(ownProp({ zero: 0 }, "zero"), 0);
  assert.equal(ownProp({ blank: "" }, "blank"), "");
});

test("ownProp on an empty object is undefined for any key", () => {
  assert.equal(ownProp<number>({}, "anything"), undefined);
});
