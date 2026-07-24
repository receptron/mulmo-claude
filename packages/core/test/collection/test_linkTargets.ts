// `uniqueRefTargets` / `uniqueEmbedTargets` / `uniqueBacklinkSources` are the
// SINGLE implementation of "which linked collections a schema must preload",
// walked identically by server enrichment (`server/derive.ts`) and the client
// linked-cache fetch (collection-plugin). They used to be hand-mirrored copies;
// these tests pin the shared behaviour so the two surfaces can't drift: ref
// one level inside a table is collected, embeds/backlinks/rollups stay
// top-level, backlinks and rollups sharing a `from` load once, and empty /
// unrelated schemas yield nothing.
import { test } from "node:test";
import assert from "node:assert/strict";

import { uniqueBacklinkSources, uniqueEmbedTargets, uniqueRefTargets } from "../../src/collection/core/linkTargets.ts";
import { SubFieldSpecZ } from "../../src/collection/core/schemaZ.ts";
import type { CollectionFieldSpec, CollectionSchema } from "../../src/collection/core/schema.ts";

function schemaWith(fields: Record<string, CollectionFieldSpec>): CollectionSchema {
  return { title: "T", icon: "📦", primaryKey: "id", fields };
}

test("uniqueRefTargets collects a top-level ref and dedups repeats", () => {
  const schema = schemaWith({
    owner: { type: "ref", label: "Owner", to: "people" },
    reviewer: { type: "ref", label: "Reviewer", to: "people" },
    project: { type: "ref", label: "Project", to: "projects" },
  });
  assert.deepEqual(uniqueRefTargets(schema).sort(), ["people", "projects"]);
});

test("uniqueRefTargets descends one level into a table's ref sub-field", () => {
  const schema = schemaWith({
    title: { type: "string", label: "Title" },
    cast: {
      type: "table",
      label: "Cast",
      of: {
        character: { type: "ref", label: "Character", to: "characters" },
        lines: { type: "number", label: "Lines" },
      },
    },
  });
  // The ref lives inside the table's `of`; only reachable via the one-level
  // recursion. The scalar sub-column contributes nothing.
  assert.deepEqual(uniqueRefTargets(schema), ["characters"]);
});

test("uniqueRefTargets skips a ref whose `to` is empty", () => {
  const schema = schemaWith({ broken: { type: "ref", label: "Broken", to: "" } });
  assert.deepEqual(uniqueRefTargets(schema), []);
});

test("nested tables are schema-rejected, so one-level recursion is complete", () => {
  // The walker relies on this invariant: a `table` sub-field cannot itself be a
  // `table`, so a ref can never sit more than one level deep. Pin it — if
  // SubFieldSpecZ ever admitted `table`, "one recursion suffices" would silently
  // become wrong and a doubly-nested ref would go unloaded.
  const nestedTable = SubFieldSpecZ.safeParse({ type: "table", label: "Inner", of: { x: { type: "string", label: "X" } } });
  assert.equal(nestedTable.success, false);
});

test("uniqueEmbedTargets collects top-level embeds and ignores a table", () => {
  const schema = schemaWith({
    profile: { type: "embed", label: "Profile", to: "profiles", id: "me" },
    issuer: { type: "embed", label: "Issuer", to: "profiles", idField: "issuerId" },
    rows: { type: "table", label: "Rows", of: { who: { type: "ref", label: "Who", to: "people" } } },
  });
  // Embeds are top-level only (the schema rejects `embed` inside a table's
  // `of`), so the table's ref is NOT an embed target.
  assert.deepEqual(uniqueEmbedTargets(schema), ["profiles"]);
});

test("uniqueBacklinkSources loads a backlinks + rollup sharing one `from` exactly once", () => {
  const schema = schemaWith({
    invoices: { type: "backlinks", label: "Invoices", from: "invoices", via: "clientId", display: ["total"] },
    invoiceTotal: { type: "rollup", label: "Total", from: "invoices", via: "clientId", op: "sum", column: "total" },
    invoiceCount: { type: "rollup", label: "Count", from: "invoices", via: "clientId", op: "count" },
    orders: { type: "rollup", label: "Orders", from: "orders", via: "clientId", op: "count" },
  });
  // The two kinds share one whole-collection load — `invoices` appears once.
  assert.deepEqual(uniqueBacklinkSources(schema).sort(), ["invoices", "orders"]);
});

test("empty schema yields no targets from any walker", () => {
  const schema = schemaWith({});
  assert.deepEqual(uniqueRefTargets(schema), []);
  assert.deepEqual(uniqueEmbedTargets(schema), []);
  assert.deepEqual(uniqueBacklinkSources(schema), []);
});

test("a schema with none of the linking field types yields no targets", () => {
  const schema = schemaWith({
    name: { type: "string", label: "Name" },
    amount: { type: "money", label: "Amount", currency: "USD" },
    status: { type: "enum", label: "Status", values: ["open", "done"] },
  });
  assert.deepEqual(uniqueRefTargets(schema), []);
  assert.deepEqual(uniqueEmbedTargets(schema), []);
  assert.deepEqual(uniqueBacklinkSources(schema), []);
});
