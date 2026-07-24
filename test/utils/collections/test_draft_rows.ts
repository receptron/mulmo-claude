// Unit tests for emptyRow / rowFromItem in @mulmoclaude/core/collection.
// They share the internal buildTableRowDraft accumulator; these tests pin
// the boolean-presence semantics (an explicit persisted `false` is
// "present" and round-trips; an absent boolean is not) and the
// emptyRow == "read undefined for every sub-field" equivalence.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { emptyRow, rowFromItem, type CollectionFieldSpec as FieldSpec } from "@mulmoclaude/core/collection";

const subFields: Record<string, FieldSpec> = {
  name: { type: "string", label: "Name" },
  done: { type: "boolean", label: "Done" },
};

describe("emptyRow", () => {
  it("blank text slots and all-false, all-absent boolean slots", () => {
    assert.deepEqual(emptyRow(subFields), {
      text: { name: "" },
      bool: { done: false },
      boolOriginallyPresent: { done: false },
      boolTouched: { done: false },
    });
  });
});

describe("rowFromItem", () => {
  it("reads text and marks a present boolean as originally present", () => {
    assert.deepEqual(rowFromItem({ name: "Milk", done: true }, subFields), {
      text: { name: "Milk" },
      bool: { done: true },
      boolOriginallyPresent: { done: true },
      boolTouched: { done: false },
    });
  });

  it("treats an explicit persisted `false` as present (round-trips on no-op save)", () => {
    const row = rowFromItem({ name: "Milk", done: false }, subFields);
    assert.equal(row.bool.done, false);
    assert.equal(row.boolOriginallyPresent.done, true);
  });

  it("treats an absent boolean as not present", () => {
    const row = rowFromItem({ name: "Milk" }, subFields);
    assert.equal(row.bool.done, false);
    assert.equal(row.boolOriginallyPresent.done, false);
  });

  it("stringifies a non-string scalar via fieldText", () => {
    const row = rowFromItem({ name: 42 }, subFields);
    assert.equal(row.text.name, "42");
  });

  it("equals emptyRow when the source record is empty", () => {
    assert.deepEqual(rowFromItem({}, subFields), emptyRow(subFields));
  });
});
