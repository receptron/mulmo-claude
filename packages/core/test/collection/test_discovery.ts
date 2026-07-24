// The post-Zod acceptance gate resolves `schema.fields[primaryKey]`. A bare
// index on a primaryKey named after an Object.prototype member (`toString`,
// `constructor`) reads an inherited function, passes the "is it declared?"
// gate, then fails the NEXT gate — handing the author the wrong, unactionable
// "add `primary: true`" error instead of "primaryKey is not a declared field".
// These tests pin the own-property guard shared by discovery + putSchema.
import { test } from "node:test";
import assert from "node:assert/strict";

import { acceptParsedSchema, resolvePrimaryField } from "../../src/collection/server/discovery.ts";
import type { CollectionSchema } from "../../src/collection/core/schema.ts";

function schemaWith(primaryKey: string, fields: CollectionSchema["fields"]): CollectionSchema {
  return { title: "T", icon: "x", primaryKey, dataPath: "data/t", fields };
}

const declaredId: CollectionSchema["fields"] = { id: { type: "string", label: "Id", primary: true } };

test("resolvePrimaryField returns the declared field, and undefined on a miss", () => {
  assert.deepEqual(resolvePrimaryField(declaredId, "id"), { type: "string", label: "Id", primary: true });
  assert.equal(resolvePrimaryField(declaredId, "missing"), undefined);
});

test("resolvePrimaryField misses on a prototype-chain key instead of an inherited function", () => {
  assert.equal(resolvePrimaryField(declaredId, "toString"), undefined);
  assert.equal(resolvePrimaryField(declaredId, "constructor"), undefined);
  assert.equal(resolvePrimaryField(declaredId, "__proto__"), undefined);
});

test("acceptParsedSchema rejects a prototype-named primaryKey with the DECLARED-FIELD reason", () => {
  const result = acceptParsedSchema(schemaWith("toString", declaredId), { source: "project", workspaceRoot: "/ws", slug: "s" });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /is not one of the declared fields/);
  assert.doesNotMatch(result.ok === false ? result.reason : "", /primary: true/);
});
