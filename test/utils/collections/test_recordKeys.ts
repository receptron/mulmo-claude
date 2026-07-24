// Unit tests for the pure per-cell key + empty-enum snapshot helpers
// (packages/core/src/collection/core/recordKeys.ts).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cellKey, snapshotEmptyEnums, type EnumSnapshotSchema, type CollectionItem } from "@mulmoclaude/core/collection";

describe("cellKey", () => {
  it("joins row id and field key with a colon", () => {
    assert.equal(cellKey("r-1", "status"), "r-1:status");
  });

  it("keeps distinct rows/fields distinct", () => {
    assert.notEqual(cellKey("r-1", "a"), cellKey("r-1", "b"));
    assert.notEqual(cellKey("r-1", "a"), cellKey("r-2", "a"));
  });
});

const schema: EnumSnapshotSchema = {
  primaryKey: "id",
  fields: {
    id: { type: "string" },
    status: { type: "enum" },
    priority: { type: "enum" },
    title: { type: "string" },
  },
};

describe("snapshotEmptyEnums", () => {
  it("returns an empty set when the schema declares no enum fields", () => {
    const noEnums: EnumSnapshotSchema = { primaryKey: "id", fields: { id: { type: "string" }, title: { type: "text" } } };
    assert.equal(snapshotEmptyEnums(noEnums, [{ id: "a", title: "x" }]).size, 0);
  });

  it("keys the enum cells that are empty (null / undefined / empty string) at load", () => {
    const records: CollectionItem[] = [
      { id: "a", status: "open", priority: "" }, // priority empty
      { id: "b", status: null, priority: "high" }, // status null
      { id: "c" }, // both missing
    ];
    const empty = snapshotEmptyEnums(schema, records);
    assert.equal(empty.has("a:priority"), true);
    assert.equal(empty.has("b:status"), true);
    assert.equal(empty.has("c:status"), true);
    assert.equal(empty.has("c:priority"), true);
    // Populated enum cells are NOT flagged.
    assert.equal(empty.has("a:status"), false);
    assert.equal(empty.has("b:priority"), false);
    assert.equal(empty.size, 4);
  });

  it("never keys non-enum fields even when they are empty", () => {
    const empty = snapshotEmptyEnums(schema, [{ id: "a", status: "open", priority: "low", title: "" }]);
    assert.equal(empty.has("a:title"), false);
    assert.equal(empty.size, 0);
  });

  it("stringifies the primary-key value for the row segment of the key", () => {
    const numericPk: EnumSnapshotSchema = { primaryKey: "n", fields: { n: { type: "number" }, status: { type: "enum" } } };
    const empty = snapshotEmptyEnums(numericPk, [{ n: 7 }]);
    assert.equal(empty.has("7:status"), true);
  });

  it("returns an empty set for no records", () => {
    assert.equal(snapshotEmptyEnums(schema, []).size, 0);
  });
});
