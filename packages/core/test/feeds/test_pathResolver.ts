import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getByPath, getItemsArray } from "../../src/feeds/server/pathResolver.ts";

describe("getByPath", () => {
  const root = {
    title: "Hello",
    data: { name: "Ada", nested: { deep: 42 } },
    results: [{ id: "x" }, { id: "y" }],
    hourly: [1, 2, 3],
  };

  it("reads a top-level key", () => {
    assert.equal(getByPath(root, "title"), "Hello");
  });

  it("reads a dotted path", () => {
    assert.equal(getByPath(root, "data.name"), "Ada");
    assert.equal(getByPath(root, "data.nested.deep"), 42);
  });

  it("reads an indexed array element", () => {
    assert.equal(getByPath(root, "results[0].id"), "x");
    assert.equal(getByPath(root, "results[1].id"), "y");
  });

  it("treats a trailing [] as the array itself", () => {
    assert.deepEqual(getByPath(root, "hourly[]"), [1, 2, 3]);
  });

  it("returns undefined on a miss (wrong type / absent key / out of range)", () => {
    assert.equal(getByPath(root, "data.missing"), undefined);
    assert.equal(getByPath(root, "title.nope"), undefined);
    assert.equal(getByPath(root, "results[9].id"), undefined);
    assert.equal(getByPath(null, "anything"), undefined);
  });

  it("misses on a prototype-chain key instead of returning an inherited function", () => {
    // Without the own-property guard, `{}["toString"]` returns the
    // Object.prototype function, which would flow into a `naturalKey`.
    assert.equal(getByPath(root, "toString"), undefined);
    assert.equal(getByPath(root, "constructor"), undefined);
    assert.equal(getByPath(root, "data.__proto__"), undefined);
    assert.equal(getByPath(root, "data.hasOwnProperty"), undefined);
  });
});

describe("getItemsArray", () => {
  it("walks itemsAt to an array", () => {
    assert.deepEqual(getItemsArray({ hourly: [1, 2] }, "hourly[]"), [1, 2]);
    assert.deepEqual(getItemsArray({ data: { results: [{ a: 1 }] } }, "data.results[]"), [{ a: 1 }]);
  });

  it("uses the root when itemsAt is absent and root is an array", () => {
    assert.deepEqual(getItemsArray([{ a: 1 }], undefined), [{ a: 1 }]);
  });

  it("returns [] when the target is not an array", () => {
    assert.deepEqual(getItemsArray({ hourly: "nope" }, "hourly[]"), []);
    assert.deepEqual(getItemsArray({ a: 1 }, undefined), []);
  });
});
