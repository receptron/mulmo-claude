// Unit tests for the pure `where` predicate
// (packages/core/src/collection/core/where.ts) — the AND-of-conditions
// matcher behind `DynamicIconSource.where` / `DynamicIconRule.where`. No
// fs, no server state.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { matchesWhere, type Where } from "@mulmoclaude/core/collection";

describe("matchesWhere", () => {
  it("eq: true when the field equals the value, false otherwise", () => {
    const where: Where = [{ field: "status", op: "eq", value: "done" }];
    assert.equal(matchesWhere(where, { status: "done" }), true);
    assert.equal(matchesWhere(where, { status: "open" }), false);
  });

  it("ne: true when the field differs from the value, false when equal", () => {
    const where: Where = [{ field: "status", op: "ne", value: "done" }];
    assert.equal(matchesWhere(where, { status: "open" }), true);
    assert.equal(matchesWhere(where, { status: "done" }), false);
  });

  it("in: true when the field is one of the values, false otherwise", () => {
    const where: Where = [{ field: "condition", op: "in", value: ["rain", "snow"] }];
    assert.equal(matchesWhere(where, { condition: "rain" }), true);
    assert.equal(matchesWhere(where, { condition: "sunny" }), false);
  });

  it("gt: true when the numeric field is greater, false otherwise", () => {
    const where: Where = [{ field: "temp", op: "gt", value: "20" }];
    assert.equal(matchesWhere(where, { temp: "25" }), true);
    assert.equal(matchesWhere(where, { temp: "20" }), false);
    assert.equal(matchesWhere(where, { temp: "15" }), false);
  });

  it("gte: true when the numeric field is greater or equal, false otherwise", () => {
    const where: Where = [{ field: "temp", op: "gte", value: "20" }];
    assert.equal(matchesWhere(where, { temp: "20" }), true);
    assert.equal(matchesWhere(where, { temp: "19" }), false);
  });

  it("lt: true when the numeric field is less, false otherwise", () => {
    const where: Where = [{ field: "temp", op: "lt", value: "20" }];
    assert.equal(matchesWhere(where, { temp: "15" }), true);
    assert.equal(matchesWhere(where, { temp: "20" }), false);
  });

  it("lte: true when the numeric field is less or equal, false otherwise", () => {
    const where: Where = [{ field: "temp", op: "lte", value: "20" }];
    assert.equal(matchesWhere(where, { temp: "20" }), true);
    assert.equal(matchesWhere(where, { temp: "21" }), false);
  });

  it("contains: true when the field substring-matches, false otherwise", () => {
    const where: Where = [{ field: "title", op: "contains", value: "storm" }];
    assert.equal(matchesWhere(where, { title: "tropical storm warning" }), true);
    assert.equal(matchesWhere(where, { title: "clear skies" }), false);
  });

  it("MISSING field: ne is true, every other op is false", () => {
    assert.equal(matchesWhere([{ field: "x", op: "ne", value: "a" }], {}), true);
    assert.equal(matchesWhere([{ field: "x", op: "eq", value: "a" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "in", value: ["a"] }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "gt", value: "1" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "gte", value: "1" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "lt", value: "1" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "lte", value: "1" }], {}), false);
    assert.equal(matchesWhere([{ field: "x", op: "contains", value: "a" }], {}), false);
  });

  it("MISSING field: undefined and null are both treated as missing", () => {
    assert.equal(matchesWhere([{ field: "x", op: "ne", value: "a" }], { x: undefined }), true);
    assert.equal(matchesWhere([{ field: "x", op: "ne", value: "a" }], { x: null }), true);
    assert.equal(matchesWhere([{ field: "x", op: "eq", value: "a" }], { x: null }), false);
  });

  it("numeric comparisons with a non-numeric value are false, not thrown", () => {
    assert.equal(matchesWhere([{ field: "temp", op: "gt", value: "cold" }], { temp: "25" }), false);
    assert.equal(matchesWhere([{ field: "temp", op: "gt", value: "20" }], { temp: "warm" }), false);
    assert.equal(matchesWhere([{ field: "temp", op: "lte", value: "20" }], { temp: "" }), false);
  });

  it("multi-condition AND: true only when every condition matches", () => {
    const where: Where = [
      { field: "condition", op: "eq", value: "rain" },
      { field: "temp", op: "gte", value: "10" },
    ];
    assert.equal(matchesWhere(where, { condition: "rain", temp: "12" }), true);
    assert.equal(matchesWhere(where, { condition: "rain", temp: "5" }), false);
    assert.equal(matchesWhere(where, { condition: "sunny", temp: "12" }), false);
  });

  it("an empty where array matches everything", () => {
    assert.equal(matchesWhere([], {}), true);
    assert.equal(matchesWhere([], { anything: "goes" }), true);
  });
});

describe("matchesWhere with valueFrom", () => {
  it("eq: resolves the value from recordsById and matches", () => {
    const where: Where = [{ field: "office", op: "eq", valueFrom: { record: "_config", field: "defaultCity" } }];
    const recordsById = { _config: { defaultCity: "tokyo" } };
    assert.equal(matchesWhere(where, { office: "tokyo" }, recordsById), true);
  });

  it("eq: resolves the value from recordsById and does not match", () => {
    const where: Where = [{ field: "office", op: "eq", valueFrom: { record: "_config", field: "defaultCity" } }];
    const recordsById = { _config: { defaultCity: "osaka" } };
    assert.equal(matchesWhere(where, { office: "tokyo" }, recordsById), false);
  });

  it("UNRESOLVED valueFrom (missing target record): false for eq and for ne", () => {
    const eqWhere: Where = [{ field: "office", op: "eq", valueFrom: { record: "_config", field: "defaultCity" } }];
    const neWhere: Where = [{ field: "office", op: "ne", valueFrom: { record: "_config", field: "defaultCity" } }];
    assert.equal(matchesWhere(eqWhere, { office: "tokyo" }, {}), false);
    assert.equal(matchesWhere(neWhere, { office: "tokyo" }, {}), false);
  });

  it("UNRESOLVED valueFrom (missing field on the target record): false for eq and for ne", () => {
    const eqWhere: Where = [{ field: "office", op: "eq", valueFrom: { record: "_config", field: "defaultCity" } }];
    const neWhere: Where = [{ field: "office", op: "ne", valueFrom: { record: "_config", field: "defaultCity" } }];
    const recordsById = { _config: { otherField: "tokyo" } };
    assert.equal(matchesWhere(eqWhere, { office: "tokyo" }, recordsById), false);
    assert.equal(matchesWhere(neWhere, { office: "tokyo" }, recordsById), false);
  });

  it("a 2-arg matchesWhere call (no recordsById) with a valueFrom cond is always false", () => {
    const where: Where = [{ field: "office", op: "eq", valueFrom: { record: "_config", field: "defaultCity" } }];
    assert.equal(matchesWhere(where, { office: "tokyo" }), false);
  });

  it("in + valueFrom (resolves to a string, not a set): false, never substring", () => {
    // `resolveValue` stringifies every valueFrom result; `in` must stay
    // membership-only, so a string comparand can't accidentally substring-match.
    const where: Where = [{ field: "code", op: "in", valueFrom: { record: "_config", field: "allowed" } }];
    assert.equal(matchesWhere(where, { code: "rain" }, { _config: { allowed: "rain" } }), false);
    // even when the field value is a substring of the resolved string
    assert.equal(matchesWhere([{ field: "code", op: "in", valueFrom: { field: "list" } }], { code: "ai", list: "rain" }), false);
  });

  it("same-record valueFrom (record omitted): field-to-field compare", () => {
    const over: Where = [{ field: "spent", op: "gt", valueFrom: { field: "budget" } }];
    assert.equal(matchesWhere(over, { spent: "120", budget: "100" }), true);
    assert.equal(matchesWhere(over, { spent: "80", budget: "100" }), false);
    // missing sibling field on the same record → unresolved → false
    assert.equal(matchesWhere(over, { spent: "120" }), false);
  });
});

// Regression for #2323: `cond.field` / `valueFrom.record` / `valueFrom.field`
// are LLM-authored keys. A bare index read reaches Object.prototype members —
// `record["toString"]` is a function (`isMissing` false → spurious match),
// `recordsById["constructor"]` is the `Object` function whose `["name"]` is the
// plausible bogus value `"Object"`. Every such key must resolve as absent /
// unresolved, never matching.
describe("matchesWhere — prototype keys resolve as absent (#2323)", () => {
  it("cond.field is a prototype key → treated as missing, not a matched value", () => {
    // `record["toString"]` would be a function; `contains` would spuriously match.
    assert.equal(matchesWhere([{ field: "toString", op: "contains", value: "function" }], {}), false);
    assert.equal(matchesWhere([{ field: "constructor", op: "contains", value: "Object" }], {}), false);
    assert.equal(matchesWhere([{ field: "hasOwnProperty", op: "contains", value: "native" }], {}), false);
  });

  it("valueFrom.record is a prototype key → unresolved, never matches (eq and ne)", () => {
    // recordsById["constructor"] → Object fn; Object["name"] === "Object".
    const eqWhere: Where = [{ field: "office", op: "eq", valueFrom: { record: "constructor", field: "name" } }];
    const neWhere: Where = [{ field: "office", op: "ne", valueFrom: { record: "constructor", field: "name" } }];
    assert.equal(matchesWhere(eqWhere, { office: "Object" }, {}), false);
    assert.equal(matchesWhere(neWhere, { office: "tokyo" }, {}), false);
  });

  it("valueFrom.field (same record) is a prototype key → unresolved, never matches", () => {
    // record["constructor"] would be a function; a broken ref must not match.
    assert.equal(matchesWhere([{ field: "office", op: "ne", valueFrom: { field: "constructor" } }], { office: "tokyo" }), false);
    assert.equal(matchesWhere([{ field: "office", op: "ne", valueFrom: { field: "toString" } }], { office: "tokyo" }), false);
  });

  it("valueFrom.field (cross record) is a prototype key → unresolved, never matches", () => {
    const neWhere: Where = [{ field: "office", op: "ne", valueFrom: { record: "_config", field: "toString" } }];
    assert.equal(matchesWhere(neWhere, { office: "tokyo" }, { _config: { defaultCity: "x" } }), false);
  });

  it("BOUNDARY: an OWN field literally named `toString` still resolves normally", () => {
    assert.equal(matchesWhere([{ field: "toString", op: "eq", value: "hello" }], { toString: "hello" }), true);
    assert.equal(matchesWhere([{ field: "toString", op: "eq", value: "hello" }], { toString: "world" }), false);
    // …and as a valueFrom target the own value resolves too.
    const where: Where = [{ field: "office", op: "eq", valueFrom: { record: "_config", field: "toString" } }];
    assert.equal(matchesWhere(where, { office: "hi" }, { _config: { toString: "hi" } }), true);
  });
});
