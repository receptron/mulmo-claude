// Boolean coercion shared by the logical functions. The bug this covers: IF and
// AND/OR read the SAME value oppositely — IF("0") took the true branch while
// AND("0") was false — because each function coerced truthiness its own way
// (#2387). One shared rule keeps them in agreement.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";
import { coerceToBoolean } from "../../../../src/plugins/spreadsheet/engine/coerce-boolean.ts";

describe("coerceToBoolean", () => {
  it("passes booleans through", () => {
    assert.equal(coerceToBoolean(true), true);
    assert.equal(coerceToBoolean(false), false);
  });

  it("treats only 0 as false among numbers", () => {
    assert.equal(coerceToBoolean(0), false);
    assert.equal(coerceToBoolean(1), true);
    assert.equal(coerceToBoolean(-1), true);
    assert.equal(coerceToBoolean(0.5), true);
  });

  it("treats blank and empty as false", () => {
    assert.equal(coerceToBoolean(""), false);
    assert.equal(coerceToBoolean("   "), false);
    assert.equal(coerceToBoolean(null), false);
    assert.equal(coerceToBoolean(undefined), false);
  });

  it("reads the words true/false case-insensitively", () => {
    assert.equal(coerceToBoolean("true"), true);
    assert.equal(coerceToBoolean("TRUE"), true);
    assert.equal(coerceToBoolean("false"), false);
    assert.equal(coerceToBoolean("False"), false);
  });

  // The crux of #2387: a numeric string follows its number, so "0" is false in
  // every logical function — not true in IF and false in AND.
  it("follows the number in a numeric string", () => {
    assert.equal(coerceToBoolean("0"), false);
    assert.equal(coerceToBoolean("0.0"), false);
    assert.equal(coerceToBoolean("5"), true);
    assert.equal(coerceToBoolean("-3"), true);
  });

  it("treats other non-empty text as true", () => {
    assert.equal(coerceToBoolean("hello"), true);
    assert.equal(coerceToBoolean("no"), true);
  });
});

describe("IF and AND/OR/NOT agree on the same value", () => {
  const evalFormula = (formula: string): unknown => new SpreadsheetEngine().calculate({ name: "S", data: [[{ v: formula }]] } satisfies SheetData).data[0][0];

  // Each value should send IF down the false branch exactly when AND/OR/NOT read
  // it as false. Previously IF("0") returned 1 while AND("0") returned false.
  for (const [literal, truthy] of [
    ['"0"', false],
    ['"false"', false],
    ['""', false],
    ["0", false],
    ['"5"', true],
    ['"hello"', true],
    ["1", true],
  ] as const) {
    it(`agrees that ${literal} is ${truthy ? "true" : "false"}`, () => {
      assert.equal(evalFormula(`=IF(${literal}, 1, 2)`), truthy ? 1 : 2, "IF branch");
      assert.equal(evalFormula(`=AND(${literal})`), truthy, "AND");
      assert.equal(evalFormula(`=OR(${literal})`), truthy, "OR");
      assert.equal(evalFormula(`=NOT(${literal})`), !truthy, "NOT");
    });
  }
});
