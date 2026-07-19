// Unit tests for the shared field-to-text helpers
// (packages/core/src/collection/core/fieldText.ts).
//
// The case that matters is the array/object one: `CollectionItem` values are
// `unknown`, and real workspace records carry arrays and nested objects. Bare
// `String(value)` turns those into "[object Object]", which then gets compared
// or displayed as if it were a value — silently, with nothing thrown.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fieldText, fieldTextOrNull } from "@mulmoclaude/core/collection";

describe("fieldTextOrNull", () => {
  it("returns the text of a primitive", () => {
    assert.equal(fieldTextOrNull("done"), "done");
    assert.equal(fieldTextOrNull(42), "42");
    assert.equal(fieldTextOrNull(0), "0");
    assert.equal(fieldTextOrNull(true), "true");
    assert.equal(fieldTextOrNull(false), "false");
  });

  it("keeps an empty string distinct from an absent field", () => {
    assert.equal(fieldTextOrNull(""), "");
    assert.equal(fieldTextOrNull(undefined), null);
    assert.equal(fieldTextOrNull(null), null);
  });

  it("refuses arrays and objects instead of yielding [object Object]", () => {
    assert.equal(fieldTextOrNull({ name: "site" }), null);
    assert.equal(fieldTextOrNull([{ name: "site" }]), null);
    assert.equal(fieldTextOrNull([]), null);
    assert.equal(fieldTextOrNull({}), null);
  });

  // The whole point: a matcher must not accept an object-valued field just
  // because two different objects both stringify to the same "[object Object]".
  it("cannot make two unrelated objects compare equal", () => {
    const left = fieldTextOrNull({ a: 1 });
    const right = fieldTextOrNull({ b: 2 });
    assert.equal(String({ a: 1 }), String({ b: 2 })); // the trap being avoided
    assert.equal(left, null);
    assert.equal(right, null);
  });

  it("renders a Date as ISO rather than a locale-dependent string", () => {
    assert.equal(fieldTextOrNull(new Date("2026-07-19T00:00:00.000Z")), "2026-07-19T00:00:00.000Z");
  });

  // An unparseable date is still `instanceof Date`, and `toISOString()` throws
  // `RangeError` on it. Since this helper sits on the match/sort/display paths,
  // that would turn one bad record into a failed render.
  it("treats an invalid Date as having no text instead of throwing", () => {
    const invalid = new Date("not-a-date");
    assert.equal(invalid instanceof Date, true);
    assert.throws(() => invalid.toISOString(), RangeError);
    assert.doesNotThrow(() => fieldTextOrNull(invalid));
    assert.equal(fieldTextOrNull(invalid), null);
    assert.equal(fieldText(invalid, "—"), "—");
  });
});

describe("fieldText", () => {
  it("falls back to an empty string by default", () => {
    assert.equal(fieldText(undefined), "");
    assert.equal(fieldText({ nested: true }), "");
  });

  it("uses the supplied fallback", () => {
    assert.equal(fieldText(undefined, "—"), "—");
    assert.equal(fieldText([1, 2], "—"), "—");
  });

  it("passes primitives straight through", () => {
    assert.equal(fieldText("value", "—"), "value");
    assert.equal(fieldText(0, "—"), "0");
    assert.equal(fieldText(false, "—"), "false");
  });
});
