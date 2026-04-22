import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRecord, isObj, isNonEmptyString, isStringRecord, isStringArray, isErrorWithCode, hasStringProp, hasNumberProp } from "../../server/utils/types.js";

// ── isRecord ────────────────────────────────────────────────────

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

// ── isObj ───────────────────────────────────────────────────────

describe("isObj", () => {
  it("accepts plain objects", () => {
    assert.equal(isObj({}), true);
    assert.equal(isObj({ a: 1 }), true);
  });

  it("accepts arrays (unlike isRecord)", () => {
    assert.equal(isObj([]), true);
    assert.equal(isObj([1, 2]), true);
  });

  it("rejects null", () => {
    assert.equal(isObj(null), false);
  });

  it("rejects undefined", () => {
    assert.equal(isObj(undefined), false);
  });

  it("rejects primitives", () => {
    assert.equal(isObj("string"), false);
    assert.equal(isObj(42), false);
    assert.equal(isObj(true), false);
  });
});

// ── isNonEmptyString ────────────────────────────────────────────

describe("isNonEmptyString", () => {
  it("accepts non-empty strings", () => {
    assert.equal(isNonEmptyString("hello"), true);
    assert.equal(isNonEmptyString("a"), true);
  });

  it("rejects empty string", () => {
    assert.equal(isNonEmptyString(""), false);
  });

  it("rejects whitespace-only string", () => {
    assert.equal(isNonEmptyString("   "), false);
    assert.equal(isNonEmptyString("\t\n"), false);
  });

  it("rejects non-strings", () => {
    assert.equal(isNonEmptyString(null), false);
    assert.equal(isNonEmptyString(undefined), false);
    assert.equal(isNonEmptyString(42), false);
    assert.equal(isNonEmptyString({}), false);
  });
});

// ── isStringRecord ──────────────────────────────────────────────

describe("isStringRecord", () => {
  it("accepts record with all string values", () => {
    assert.equal(isStringRecord({ a: "x", b: "y" }), true);
  });

  it("accepts empty object", () => {
    assert.equal(isStringRecord({}), true);
  });

  it("rejects mixed values", () => {
    assert.equal(isStringRecord({ a: "x", b: 42 }), false);
  });

  it("rejects non-objects", () => {
    assert.equal(isStringRecord(null), false);
    assert.equal(isStringRecord("string"), false);
    assert.equal(isStringRecord([]), false);
  });
});

// ── isStringArray ───────────────────────────────────────────────

describe("isStringArray", () => {
  it("accepts string arrays", () => {
    assert.equal(isStringArray(["a", "b"]), true);
    assert.equal(isStringArray([]), true);
  });

  it("rejects mixed arrays", () => {
    assert.equal(isStringArray(["a", 1]), false);
    assert.equal(isStringArray([null]), false);
  });

  it("rejects non-arrays", () => {
    assert.equal(isStringArray("string"), false);
    assert.equal(isStringArray({}), false);
    assert.equal(isStringArray(null), false);
  });
});

// ── isErrorWithCode ─────────────────────────────────────────────

describe("isErrorWithCode", () => {
  it("accepts object with string code", () => {
    assert.equal(isErrorWithCode({ code: "ENOENT" }), true);
    assert.equal(isErrorWithCode({ code: "EACCES", message: "denied" }), true);
  });

  it("rejects without code", () => {
    assert.equal(isErrorWithCode({}), false);
    assert.equal(isErrorWithCode({ message: "error" }), false);
  });

  it("rejects non-string code", () => {
    assert.equal(isErrorWithCode({ code: 42 }), false);
  });

  it("rejects non-objects", () => {
    assert.equal(isErrorWithCode(null), false);
    assert.equal(isErrorWithCode("ENOENT"), false);
  });

  it("accepts real Error with code (Node.js style)", () => {
    const err = Object.assign(new Error("fail"), { code: "ENOENT" });
    assert.equal(isErrorWithCode(err), true);
  });
});

// ── hasStringProp ───────────────────────────────────────────────

describe("hasStringProp", () => {
  it("returns true when key exists with string value", () => {
    assert.equal(hasStringProp({ name: "alice" }, "name"), true);
  });

  it("returns false when key missing", () => {
    assert.equal(hasStringProp({}, "name"), false);
  });

  it("returns false when value is not string", () => {
    assert.equal(hasStringProp({ name: 42 }, "name"), false);
    assert.equal(hasStringProp({ name: null }, "name"), false);
  });

  it("returns false for non-objects", () => {
    assert.equal(hasStringProp(null, "name"), false);
    assert.equal(hasStringProp("str", "name"), false);
  });

  it("narrows type correctly", () => {
    const val: unknown = { id: "abc", count: 5 };
    if (hasStringProp(val, "id")) {
      const fieldId: string = val.id;
      assert.equal(fieldId, "abc");
    }
  });
});

// ── hasNumberProp ───────────────────────────────────────────────

describe("hasNumberProp", () => {
  it("returns true when key exists with number value", () => {
    assert.equal(hasNumberProp({ count: 42 }, "count"), true);
    assert.equal(hasNumberProp({ count: 0 }, "count"), true);
  });

  it("returns false when key missing", () => {
    assert.equal(hasNumberProp({}, "count"), false);
  });

  it("returns false when value is not number", () => {
    assert.equal(hasNumberProp({ count: "42" }, "count"), false);
    assert.equal(hasNumberProp({ count: null }, "count"), false);
  });

  it("returns false for non-objects", () => {
    assert.equal(hasNumberProp(null, "count"), false);
  });

  it("narrows type correctly", () => {
    const val: unknown = { score: 99 };
    if (hasNumberProp(val, "score")) {
      const score: number = val.score;
      assert.equal(score, 99);
    }
  });
});
