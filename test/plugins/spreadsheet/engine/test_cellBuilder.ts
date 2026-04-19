import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCellFromInput,
  looksLikeFormula,
  parseNonStringInput,
} from "../../../../src/plugins/spreadsheet/engine/cellBuilder.js";

describe("looksLikeFormula", () => {
  it("detects function calls at the start", () => {
    assert.equal(looksLikeFormula("SUM(A1:A3)"), true);
    assert.equal(looksLikeFormula("MAX(B1, C1)"), true);
    assert.equal(looksLikeFormula("-IF(A1>0, 1, 0)"), true);
  });

  it("detects cell reference + operator", () => {
    assert.equal(looksLikeFormula("A1+B1"), true);
    assert.equal(looksLikeFormula("AA10 * 2"), true);
    assert.equal(looksLikeFormula("A1/B1"), true);
  });

  it("detects numeric arithmetic", () => {
    assert.equal(looksLikeFormula("6/100"), true);
    assert.equal(looksLikeFormula("5 * 2"), true);
    assert.equal(looksLikeFormula("3+4"), true);
  });

  it("rejects plain text", () => {
    assert.equal(looksLikeFormula("hello world"), false);
    assert.equal(looksLikeFormula("apple pie"), false);
    assert.equal(looksLikeFormula(""), false);
  });

  it("rejects bare numbers", () => {
    assert.equal(looksLikeFormula("42"), false);
    assert.equal(looksLikeFormula("3.14"), false);
  });

  it("rejects bare cell refs (no operator)", () => {
    assert.equal(looksLikeFormula("A1"), false);
    assert.equal(looksLikeFormula("AA10"), false);
  });
});

describe("parseNonStringInput", () => {
  it("empty input → empty string", () => {
    assert.equal(parseNonStringInput(""), "");
    assert.equal(parseNonStringInput("   "), "");
  });

  it("formula → prefixed with =", () => {
    assert.equal(parseNonStringInput("SUM(A1:A3)"), "=SUM(A1:A3)");
    assert.equal(parseNonStringInput("A1+B1"), "=A1+B1");
    assert.equal(parseNonStringInput("  6/100  "), "=6/100");
  });

  it("numeric → parsed as number", () => {
    assert.equal(parseNonStringInput("42"), 42);
    assert.equal(parseNonStringInput("3.14"), 3.14);
    assert.equal(parseNonStringInput("-5"), -5);
  });

  it("non-formula non-number → raw string", () => {
    assert.equal(parseNonStringInput("hello"), "hello");
    assert.equal(parseNonStringInput("yes"), "yes");
  });

  it("rejects trailing garbage that parseFloat would silently accept", () => {
    // parseFloat("42abc") returns 42; we want the string preserved.
    assert.equal(parseNonStringInput("42abc"), "42abc");
    assert.equal(parseNonStringInput("100 USD"), "100 USD");
    assert.equal(parseNonStringInput("3.14xyz"), "3.14xyz");
  });

  it("accepts scientific notation", () => {
    assert.equal(parseNonStringInput("1e3"), 1000);
    assert.equal(parseNonStringInput("-2.5E-2"), -0.025);
  });
});

describe("buildCellFromInput", () => {
  it('type "string" → v is coerced String', () => {
    const cell = buildCellFromInput({ type: "string", value: 42 });
    assert.deepEqual(cell, { v: "42" });
  });

  it('type "string" with null value', () => {
    const cell = buildCellFromInput({ type: "string", value: null });
    assert.deepEqual(cell, { v: "null" });
  });

  it('type "number" with numeric formula', () => {
    const cell = buildCellFromInput({
      type: "number",
      value: "",
      formula: "42",
    });
    assert.deepEqual(cell, { v: 42 });
  });

  it("type object with formula input", () => {
    const cell = buildCellFromInput({
      type: "formula",
      value: "",
      formula: "SUM(A1:A3)",
    });
    assert.deepEqual(cell, { v: "=SUM(A1:A3)" });
  });

  it("attaches format when provided", () => {
    const cell = buildCellFromInput({
      type: "number",
      value: "",
      formula: "100",
      format: "$#,##0.00",
    });
    assert.deepEqual(cell, { v: 100, f: "$#,##0.00" });
  });

  it("omits format when empty string", () => {
    const cell = buildCellFromInput({
      type: "number",
      value: "",
      formula: "100",
      format: "",
    });
    assert.deepEqual(cell, { v: 100 });
  });

  it("empty formula input → empty string value", () => {
    const cell = buildCellFromInput({ type: "number", value: "", formula: "" });
    assert.deepEqual(cell, { v: "" });
  });
});
