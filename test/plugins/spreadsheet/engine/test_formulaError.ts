// Pure taxonomy + classification helpers behind #2359's typed error reporting.
// These decide which Excel error value and CalculationError type a failure maps
// to; a wrong mapping silently mislabels a cell, so each direction is pinned.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FORMULA_ERROR_VALUES,
  FormulaError,
  isFormulaError,
  divZeroError,
  invalidRefError,
  nameError,
  unknownError,
  propagatedError,
  classifyThrownError,
} from "../../../../src/plugins/spreadsheet/engine/formulaError.ts";

describe("FORMULA_ERROR_VALUES", () => {
  it("maps each kind to its Excel literal", () => {
    assert.deepEqual(FORMULA_ERROR_VALUES, {
      div_zero: "#DIV/0!",
      invalid_ref: "#REF!",
      syntax: "#NAME?",
      unknown: "#ERROR!",
    });
  });
});

describe("factories carry the matching kind and display", () => {
  it("divZeroError", () => {
    const error = divZeroError();
    assert.equal(error.errorType, "div_zero");
    assert.equal(error.display, "#DIV/0!");
    assert.equal(isFormulaError(error), true);
  });

  it("invalidRefError includes the reference in the message", () => {
    const error = invalidRefError("Missing!A1");
    assert.equal(error.errorType, "invalid_ref");
    assert.equal(error.display, "#REF!");
    assert.match(error.message, /Missing!A1/);
  });

  it("nameError includes the function name in the message", () => {
    const error = nameError("UNKNOWNFN");
    assert.equal(error.errorType, "syntax");
    assert.equal(error.display, "#NAME?");
    assert.match(error.message, /UNKNOWNFN/);
  });

  it("unknownError defaults its message to the display value", () => {
    assert.equal(unknownError().message, "#ERROR!");
    assert.equal(unknownError("boom").message, "boom");
    assert.equal(unknownError().errorType, "unknown");
  });
});

describe("isFormulaError", () => {
  it("accepts a FormulaError and rejects anything else", () => {
    assert.equal(isFormulaError(new FormulaError("unknown", "#ERROR!")), true);
    assert.equal(isFormulaError(new Error("plain")), false);
    assert.equal(isFormulaError("#DIV/0!"), false);
    assert.equal(isFormulaError(null), false);
  });
});

describe("propagatedError maps a value back to its kind", () => {
  it("keeps the dedicated kind for values that have one", () => {
    assert.equal(propagatedError("#DIV/0!").errorType, "div_zero");
    assert.equal(propagatedError("#REF!").errorType, "invalid_ref");
    assert.equal(propagatedError("#NAME?").errorType, "syntax");
  });

  it("falls back to unknown for values without a dedicated kind", () => {
    assert.equal(propagatedError("#N/A").errorType, "unknown");
    assert.equal(propagatedError("#NUM!").errorType, "unknown");
  });

  it("preserves the error value as the display", () => {
    assert.equal(propagatedError("#N/A").display, "#N/A");
  });
});

describe("classifyThrownError", () => {
  it("passes a FormulaError's own kind and display through", () => {
    assert.deepEqual(classifyThrownError(divZeroError()), { type: "div_zero", display: "#DIV/0!" });
  });

  it("maps any non-FormulaError throw to unknown / #ERROR!", () => {
    assert.deepEqual(classifyThrownError(new Error("SUM accepts at most 1 argument")), { type: "unknown", display: "#ERROR!" });
    assert.deepEqual(classifyThrownError("weird"), { type: "unknown", display: "#ERROR!" });
  });
});
