import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isRecord,
  isObj,
  isNonEmptyString,
  isStringRecord,
  isStringArray,
  isUnknownArray,
  isErrorWithCode,
  hasStringProp,
  hasNumberProp,
  parseCsvList,
  parseCsvSet,
} from "../src/index.ts";

test("isRecord: plain objects only, arrays and null excluded", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord([]), false, "arrays are not records");
  assert.equal(isRecord(null), false);
  assert.equal(isRecord(undefined), false);
  assert.equal(isRecord("s"), false);
  assert.equal(isRecord(42), false);
});

test("isObj: any non-null object, arrays allowed", () => {
  assert.equal(isObj({}), true);
  assert.equal(isObj([]), true, "arrays ARE objects — use isRecord to exclude them");
  assert.equal(isObj(null), false);
  assert.equal(isObj("s"), false);
  assert.equal(isObj(0), false);
});

test("isNonEmptyString: whitespace-only counts as empty", () => {
  assert.equal(isNonEmptyString("x"), true);
  assert.equal(isNonEmptyString(""), false);
  assert.equal(isNonEmptyString("   "), false, "trimmed to empty");
  assert.equal(isNonEmptyString(0), false);
  assert.equal(isNonEmptyString(null), false);
});

test("isStringRecord: every value must be a string", () => {
  assert.equal(isStringRecord({ a: "1", b: "2" }), true);
  assert.equal(isStringRecord({}), true, "vacuously true");
  assert.equal(isStringRecord({ a: 1 }), false);
  assert.equal(isStringRecord([]), false);
  assert.equal(isStringRecord(null), false);
});

test("isStringArray: every element must be a string", () => {
  assert.equal(isStringArray(["a", "b"]), true);
  assert.equal(isStringArray([]), true, "vacuously true");
  assert.equal(isStringArray(["a", 1]), false);
  assert.equal(isStringArray("a"), false, "a string is not a string array");
  assert.equal(isStringArray(null), false);
});

test("isUnknownArray: any array, element type stays unknown", () => {
  assert.equal(isUnknownArray([]), true);
  assert.equal(isUnknownArray([1, "a", {}]), true);
  assert.equal(isUnknownArray({}), false);
  assert.equal(isUnknownArray("a"), false);
  assert.equal(isUnknownArray(null), false);
});

test("isErrorWithCode: record carrying a string `code`", () => {
  assert.equal(isErrorWithCode({ code: "ENOENT" }), true);
  assert.equal(isErrorWithCode({ code: "EACCES", message: "denied" }), true);
  assert.equal(isErrorWithCode({ code: 42 }), false, "code must be a string");
  assert.equal(isErrorWithCode({}), false);
  assert.equal(isErrorWithCode(new Error("x")), false, "plain Error has no string code");
  assert.equal(isErrorWithCode(null), false);
});

test("hasStringProp: narrows a specific key to string", () => {
  assert.equal(hasStringProp({ name: "x" }, "name"), true);
  assert.equal(hasStringProp({ name: 1 }, "name"), false);
  assert.equal(hasStringProp({}, "name"), false);
  assert.equal(hasStringProp(null, "name"), false);
});

test("hasNumberProp: narrows a specific key to number", () => {
  assert.equal(hasNumberProp({ count: 3 }, "count"), true);
  assert.equal(hasNumberProp({ count: "3" }, "count"), false);
  assert.equal(hasNumberProp({}, "count"), false);
  assert.equal(hasNumberProp(undefined, "count"), false);
});

test("parseCsvList: trims, drops empties, optional lowercase", () => {
  assert.deepEqual(parseCsvList("a, b ,,c"), ["a", "b", "c"]);
  assert.deepEqual(parseCsvList(undefined), []);
  assert.deepEqual(parseCsvList(""), []);
  assert.deepEqual(parseCsvList("   "), []);
  assert.deepEqual(parseCsvList("A,B"), ["A", "B"]);
  assert.deepEqual(parseCsvList("A, B", { lowercase: true }), ["a", "b"]);
});

test("parseCsvSet: dedupes into a Set; empty input is the allow-all sentinel", () => {
  const set = parseCsvSet("x,y,x");
  assert.equal(set.size, 2);
  assert.equal(set.has("x"), true);
  assert.equal(parseCsvSet(undefined).size, 0);
  assert.equal(parseCsvSet("").size, 0);
  assert.equal(parseCsvSet("A,a", { lowercase: true }).size, 1);
});
