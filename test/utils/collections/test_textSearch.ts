// Unit tests for the pure record text-search predicate
// (packages/core/src/collection/core/textSearch.ts).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { itemMatchesQuery, type CollectionItem } from "@mulmoclaude/core/collection";

const row: CollectionItem = {
  id: "c-1",
  name: "Acme Corp",
  city: "Portland",
  balance: 1200,
  active: true,
  contacts: [{ name: "Dana" }], // object field — skipped
  note: null,
};

describe("itemMatchesQuery", () => {
  it("matches an empty query against any item (every row contains the empty substring)", () => {
    assert.equal(itemMatchesQuery(row, ""), true);
  });

  it("matches an empty query even for a row with only object/null fields (clearing search shows every row)", () => {
    // Without the empty-query short-circuit this returned false: no scalar cell
    // reaches `includes("")` (every field is object/null), so the row would
    // vanish when the search is cleared. No scalar `id` here on purpose.
    assert.equal(itemMatchesQuery({ contacts: [{ name: "Dana" }], note: null }, ""), true);
  });

  it("matches an empty query for a fully empty record", () => {
    assert.equal(itemMatchesQuery({}, ""), true);
  });

  it("matches a substring of any scalar field", () => {
    assert.equal(itemMatchesQuery(row, "acme"), true);
    assert.equal(itemMatchesQuery(row, "portland"), true);
  });

  it("matches across multiple fields (name and city both searchable)", () => {
    assert.equal(itemMatchesQuery(row, "corp"), true);
    assert.equal(itemMatchesQuery(row, "land"), true);
  });

  it("returns false when no scalar field contains the query", () => {
    assert.equal(itemMatchesQuery(row, "seattle"), false);
  });

  it("is case-insensitive on the cell value side", () => {
    assert.equal(itemMatchesQuery(row, "acme corp"), true);
  });

  it("stringifies and matches non-string scalars (number / boolean)", () => {
    assert.equal(itemMatchesQuery(row, "1200"), true);
    assert.equal(itemMatchesQuery(row, "true"), true);
  });

  it("skips object-valued fields (nested rows are not searchable text)", () => {
    // "dana" lives only inside the `contacts` object field, so it never matches.
    assert.equal(itemMatchesQuery(row, "dana"), false);
  });

  it("skips null / undefined cells without throwing", () => {
    assert.equal(itemMatchesQuery({ a: null, b: undefined, c: "hit" }, "hit"), true);
  });

  it("does NOT lower-case the query itself — an upper-case query is the caller's bug (pinned contract)", () => {
    // The caller (`filteredItems`) pre-lowers the query once per keystroke;
    // the value side is lowered per cell. So an upper-case query matches
    // nothing here even though the data contains the text.
    assert.equal(itemMatchesQuery(row, "ACME"), false);
  });
});
