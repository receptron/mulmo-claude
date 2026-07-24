// `draftToRecord` decides which boolean fields land in a saved record. The
// decision reads `boolOriginallyPresent[key]` / `boolTouched[key]`; a bare
// index on a field named after an Object.prototype member (`toString`,
// `constructor`, `__proto__`) reads an inherited truthy function, so an
// untouched boolean would be written into every save. These tests pin the
// own-property guard: proto-named booleans stay omitted, real ones round-trip.
import { test } from "node:test";
import assert from "node:assert/strict";

import { draftToRecord } from "../../src/collection/core/draft.ts";
import type { CollectionFieldSpec, CollectionSchema } from "../../src/collection/core/schema.ts";
import type { EditState, TableRowDraft } from "../../src/collection/core/uiTypes.ts";

function emptyState(overrides: Partial<EditState> = {}): EditState {
  return { mode: "edit", text: {}, bool: {}, boolOriginallyPresent: {}, boolTouched: {}, table: {}, originalId: null, ...overrides };
}

function schemaWith(fields: CollectionSchema["fields"]): CollectionSchema {
  return { title: "T", icon: "x", primaryKey: "id", dataPath: "data/t", fields };
}

test("omits an untouched boolean field named after a prototype member", () => {
  const schema = schemaWith({
    id: { type: "string", label: "Id", primary: true },
    // `satisfies` keeps `type` narrowed: a `toString` key on a Record<string, …>
    // otherwise picks up Object.prototype.toString and widens the value to string.
    toString: { type: "boolean", label: "Flag" } satisfies CollectionFieldSpec,
  });
  const record = draftToRecord(emptyState(), schema);
  assert.equal(Object.hasOwn(record, "toString"), false);
});

test("emits a touched boolean and omits an untouched sibling", () => {
  const schema = schemaWith({
    id: { type: "string", label: "Id", primary: true },
    done: { type: "boolean", label: "Done" },
    active: { type: "boolean", label: "Active" },
  });
  const state = emptyState({ bool: { done: true }, boolTouched: { done: true } });
  const record = draftToRecord(state, schema);
  assert.equal(record.done, true);
  assert.equal(Object.hasOwn(record, "active"), false);
});

test("still emits a required boolean even when untouched", () => {
  const schema = schemaWith({
    id: { type: "string", label: "Id", primary: true },
    agreed: { type: "boolean", label: "Agreed", required: true },
  });
  const record = draftToRecord(emptyState(), schema);
  assert.equal(record.agreed, false);
});

test("omits an untouched boolean table sub-field named after a prototype member", () => {
  const row: TableRowDraft = { text: {}, bool: {}, boolOriginallyPresent: {}, boolTouched: {} };
  const schema = schemaWith({
    id: { type: "string", label: "Id", primary: true },
    rows: { type: "table", label: "Rows", of: { toString: { type: "boolean", label: "Flag" } satisfies CollectionFieldSpec } },
  });
  const record = draftToRecord(emptyState({ table: { rows: [row] } }), schema);
  assert.deepEqual(record.rows, [{}]);
});
