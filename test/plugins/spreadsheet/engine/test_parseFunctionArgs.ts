// Splitting a function's argument string into arguments. Exported but never
// tested, and it decides where every multi-argument function's arguments begin
// and end — a wrong split feeds a formula the wrong operands with no error, just
// a wrong result.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFunctionArgs } from "../../../../src/plugins/spreadsheet/engine/evaluator.ts";

describe("parseFunctionArgs — plain splitting", () => {
  it("splits comma-separated arguments and trims each", () => {
    assert.deepEqual(parseFunctionArgs("A1, B2, C3"), ["A1", "B2", "C3"]);
    assert.deepEqual(parseFunctionArgs("1,2,3"), ["1", "2", "3"]);
  });

  it("returns a single argument when there is no comma", () => {
    assert.deepEqual(parseFunctionArgs("A1"), ["A1"]);
    assert.deepEqual(parseFunctionArgs("A1:A10"), ["A1:A10"]);
  });

  it("returns nothing for an empty string", () => {
    assert.deepEqual(parseFunctionArgs(""), []);
    assert.deepEqual(parseFunctionArgs("   "), []);
  });
});

describe("parseFunctionArgs — nesting", () => {
  // A comma inside a nested call belongs to that call, not the outer one:
  // SUM(A1, MAX(B1, C1)) is two arguments, not three.
  it("keeps a comma inside a nested function with its call", () => {
    assert.deepEqual(parseFunctionArgs("A1, MAX(B1, C1)"), ["A1", "MAX(B1, C1)"]);
  });

  it("handles multiple and deeply nested calls", () => {
    assert.deepEqual(parseFunctionArgs("SUM(A1,A2), COUNT(B1,B2,B3)"), ["SUM(A1,A2)", "COUNT(B1,B2,B3)"]);
    assert.deepEqual(parseFunctionArgs("ROUND(SUM(A1,A2)/COUNT(A1,A2), 2)"), ["ROUND(SUM(A1,A2)/COUNT(A1,A2), 2)"]);
  });

  it("splits at the top level around a nested call", () => {
    assert.deepEqual(parseFunctionArgs("IF(A1>0, 1, 0), B1"), ["IF(A1>0, 1, 0)", "B1"]);
  });
});

describe("parseFunctionArgs — strings", () => {
  // A comma or a parenthesis inside a quoted string is text, not structure.
  it("keeps a comma inside a quoted string", () => {
    assert.deepEqual(parseFunctionArgs('"a, b", C1'), ['"a, b"', "C1"]);
    assert.deepEqual(parseFunctionArgs("'x, y', 1"), ["'x, y'", "1"]);
  });

  it("keeps a parenthesis inside a quoted string from disturbing the depth", () => {
    assert.deepEqual(parseFunctionArgs('"f(x)", A1'), ['"f(x)"', "A1"]);
    assert.deepEqual(parseFunctionArgs('SUM(A1), "not )a close"'), ["SUM(A1)", '"not )a close"']);
  });

  it("preserves the quotes on a quoted argument", () => {
    assert.deepEqual(parseFunctionArgs('"hello"'), ['"hello"']);
  });

  // A quote is only a boundary when it is not backslash-escaped, so an escaped
  // quote inside a string does not close it early.
  it("does not treat a backslash-escaped quote as a boundary", () => {
    assert.deepEqual(parseFunctionArgs('"say \\"hi\\", ok", B1'), ['"say \\"hi\\", ok"', "B1"]);
  });
});

describe("parseFunctionArgs — edge behaviour worth pinning", () => {
  // Documented current behaviour, not an endorsement: a trailing empty argument
  // is dropped, so IF(A1>0,"yes",) reads as TWO arguments, not three (#2359). A
  // leading or interior empty argument is kept.
  it("drops a trailing empty argument", () => {
    assert.deepEqual(parseFunctionArgs('A1, "yes",'), ["A1", '"yes"']);
  });

  it("keeps a leading or interior empty argument", () => {
    assert.deepEqual(parseFunctionArgs(",B1"), ["", "B1"]);
    assert.deepEqual(parseFunctionArgs("A1,,C1"), ["A1", "", "C1"]);
  });
});
