// Tests for src/utils/types.ts — frontend type guards.
// Mirrors test/utils/test_types.ts (server) to ensure parity.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isRecord,
  isObj,
  isNonEmptyString,
  isStringRecord,
  isStringArray,
  isErrorWithCode,
  hasStringProp,
  hasNumberProp,
} from "../../src/utils/types.js";

describe("frontend isRecord", () => {
  it("accepts plain objects", () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord({ a: 1 }), true);
  });
  it("rejects null, undefined, arrays, primitives", () => {
    assert.equal(isRecord(null), false);
    assert.equal(isRecord(undefined), false);
    assert.equal(isRecord([]), false);
    assert.equal(isRecord("str"), false);
    assert.equal(isRecord(42), false);
  });
});

describe("frontend isObj", () => {
  it("accepts objects and arrays", () => {
    assert.equal(isObj({}), true);
    assert.equal(isObj([]), true);
  });
  it("rejects null and primitives", () => {
    assert.equal(isObj(null), false);
    assert.equal(isObj("str"), false);
  });
});

describe("frontend isNonEmptyString", () => {
  it("accepts non-empty strings", () => {
    assert.equal(isNonEmptyString("hello"), true);
  });
  it("rejects empty and whitespace", () => {
    assert.equal(isNonEmptyString(""), false);
    assert.equal(isNonEmptyString("   "), false);
  });
  it("rejects non-strings", () => {
    assert.equal(isNonEmptyString(null), false);
    assert.equal(isNonEmptyString(42), false);
  });
});

describe("frontend isStringRecord", () => {
  it("accepts all-string values", () => {
    assert.equal(isStringRecord({ a: "x" }), true);
    assert.equal(isStringRecord({}), true);
  });
  it("rejects mixed values", () => {
    assert.equal(isStringRecord({ a: 1 }), false);
  });
});

describe("frontend isStringArray", () => {
  it("accepts string arrays", () => {
    assert.equal(isStringArray(["a"]), true);
    assert.equal(isStringArray([]), true);
  });
  it("rejects mixed", () => {
    assert.equal(isStringArray([1]), false);
  });
});

describe("frontend isErrorWithCode", () => {
  it("accepts object with code", () => {
    assert.equal(isErrorWithCode({ code: "ERR" }), true);
  });
  it("rejects without code", () => {
    assert.equal(isErrorWithCode({}), false);
  });
});

describe("frontend hasStringProp", () => {
  it("detects string property", () => {
    assert.equal(hasStringProp({ name: "x" }, "name"), true);
    assert.equal(hasStringProp({ name: 42 }, "name"), false);
    assert.equal(hasStringProp({}, "name"), false);
  });
});

describe("frontend hasNumberProp", () => {
  it("detects number property", () => {
    assert.equal(hasNumberProp({ n: 1 }, "n"), true);
    assert.equal(hasNumberProp({ n: "1" }, "n"), false);
    assert.equal(hasNumberProp({}, "n"), false);
  });
});
