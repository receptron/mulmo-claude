import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRecord } from "../../server/utils/types.js";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord({ a: 1 }), true);
    assert.equal(isRecord(Object.create(null)), true);
  });

  it("returns false for null", () => {
    assert.equal(isRecord(null), false);
  });

  it("returns false for arrays", () => {
    assert.equal(isRecord([]), false);
    assert.equal(isRecord([1, 2]), false);
  });

  it("returns false for primitives", () => {
    assert.equal(isRecord(undefined), false);
    assert.equal(isRecord(42), false);
    assert.equal(isRecord("string"), false);
    assert.equal(isRecord(true), false);
  });
});
