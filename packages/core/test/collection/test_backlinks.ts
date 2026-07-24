// `backlinkRows` / `rollupValue` are the single implementation the server
// enrichment (getItems) and the client detail view both derive rows through.
// The dotted `via` case (a `ref` nested one level inside a `table` field) was
// silently broken: `getOntology` advertised the relation, `putSchema` accepted
// it, but resolution used a flat `item[via]` lookup that never descended into
// table rows, so it always matched nothing. These tests pin the fix: dotted
// via matches any row, dedups per record, stays fail-soft, and leaves the
// top-level via path byte-for-byte unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";

import { backlinkRows, projectBacklinkRow, rollupValue, viaMatches } from "../../src/collection/core/backlinks.ts";
import type { CollectionItem } from "../../src/collection/core/schema.ts";

// A chapter whose `characters` table holds a `character` ref column, plus a
// couple of top-level-ref chapters for the regression case.
const chapterMulti: CollectionItem = {
  id: "ch-1",
  title: "The Duel",
  weight: 3,
  characters: [
    { character: "hero", lines: 10 },
    { character: "villain", lines: 8 },
    { character: "hero", lines: 4 },
  ],
};
const chapterHeroOnly: CollectionItem = {
  id: "ch-2",
  title: "Alone",
  weight: 1,
  characters: [{ character: "hero", lines: 20 }],
};
const chapterEmpty: CollectionItem = { id: "ch-3", title: "Prologue", weight: 5, characters: [] };
const chapterNoTable: CollectionItem = { id: "ch-4", title: "Broken", weight: 2 };

const nestedSource = [chapterMulti, chapterHeroOnly, chapterEmpty, chapterNoTable];

test("dotted via matches source records whose table has any row pointing at the record", () => {
  const rows = backlinkRows({ via: "characters.character" }, "hero", nestedSource);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["ch-1", "ch-2"],
    "both chapters referencing hero (once each), in source order",
  );
});

test("a record referenced in multiple table rows still appears once", () => {
  // chapterMulti lists `hero` in two of its three rows.
  const rows = backlinkRows({ via: "characters.character" }, "hero", [chapterMulti]);
  assert.equal(rows.length, 1, "one source record → one backlink row, not one-per-matching-row");
  assert.equal(rows[0].id, "ch-1");
});

test("dotted via is fail-soft: absent / non-array table field, or rows missing the column, match nothing", () => {
  assert.equal(viaMatches("characters.character", chapterNoTable, "hero"), false, "table field absent");
  assert.equal(viaMatches("characters.character", { characters: "not-an-array" }, "hero"), false, "table field non-array");
  assert.equal(viaMatches("characters.character", { characters: [{ lines: 1 }] }, "hero"), false, "rows lack the ref column");
  assert.equal(viaMatches("characters.character", chapterEmpty, "hero"), false, "empty table");
});

test("an exact top-level key containing a dot keeps flat-match behavior (no nesting regression)", () => {
  // `schemaZ` allows field names with dots (`z.string()`), so a top-level ref
  // column literally named "client.id" must still match `item["client.id"]`
  // rather than be reinterpreted as `item.client[].id`.
  const item: CollectionItem = { "client.id": "acme", client: [{ id: "other" }] };
  assert.equal(viaMatches("client.id", item, "acme"), true, "exact dotted key wins over the table path");
  assert.equal(viaMatches("client.id", item, "other"), false, "does NOT fall through to the client table rows");
  // With no literal "client.id" key, the same via resolves through the table.
  assert.equal(viaMatches("client.id", { client: [{ id: "acme" }] }, "acme"), true, "nested path used when no exact key exists");
});

test("deeper nesting (a.b.c) splits on the first dot and finds no matching column → no match", () => {
  const item: CollectionItem = { characters: [{ character: "hero" }] };
  // `via = "characters.character.deep"` → tableField "characters", column
  // "character.deep", which no row carries.
  assert.equal(viaMatches("characters.character.deep", item, "hero"), false);
});

test("top-level via is unchanged: matches a flat ref column, skips array/object fields", () => {
  const invoices: CollectionItem[] = [
    { id: "inv-1", clientId: "acme", total: 100 },
    { id: "inv-2", clientId: "beta", total: 50 },
    { id: "inv-3", clientId: "acme", total: 25 },
    { id: "inv-4", clientId: ["acme"], total: 999 }, // array field has no id → no match
  ];
  const rows = backlinkRows({ via: "clientId" }, "acme", invoices);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["inv-1", "inv-3"],
  );
});

test("empty recordId matches nothing (both via shapes)", () => {
  assert.deepEqual(backlinkRows({ via: "characters.character" }, "", nestedSource), []);
  assert.deepEqual(backlinkRows({ via: "clientId" }, "", [{ id: "x", clientId: "" }]), []);
});

test("filter narrows dotted-via rows, applied to the SOURCE record not the table row", () => {
  const rows = backlinkRows({ via: "characters.character", filter: { field: "title", in: ["The Duel"] } }, "hero", nestedSource);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["ch-1"],
    "ch-2 also references hero but is filtered out by the source-record title",
  );
});

test("rollupValue count/sum resolve through a dotted via", () => {
  assert.equal(rollupValue({ via: "characters.character", op: "count" }, "hero", nestedSource), 2, "two chapters reference hero");
  assert.equal(
    rollupValue({ via: "characters.character", op: "sum", column: "weight" }, "hero", nestedSource),
    4,
    "sum of source-record `weight` over ch-1 (3) + ch-2 (1)",
  );
});

test("projectBacklinkRow keeps declared columns present on the row", () => {
  const row: CollectionItem = { id: "ch-1", title: "Intro", weight: 3 };
  assert.deepEqual(projectBacklinkRow(row, ["title"], "id"), { id: "ch-1", title: "Intro" });
});

test("projectBacklinkRow drops a display column named after an Object.prototype member", () => {
  // The row has no own `toString` — a prototype-chain read would project the
  // inherited function, which `JSON.stringify` then silently drops, making the
  // column look empty to the LLM. The own-property guard omits it outright.
  const row: CollectionItem = { id: "ch-1" };
  assert.deepEqual(projectBacklinkRow(row, ["toString"], "id"), { id: "ch-1" });
  assert.deepEqual(projectBacklinkRow(row, ["constructor", "hasOwnProperty"], "id"), { id: "ch-1" });
});
