// The error taxonomy: which CODES the engine knows, and which values count as
// an error RESULT. Since #2451 an error is its own value, so `isErrorResult`
// deliberately rejects a look-alike string — that is what lets IFERROR tell
// SQRT(-1) apart from CONCAT("#N","UM!"). The provenance behaviour itself is
// covered in test_errorValue.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSpreadsheetError,
  isErrorResult,
  errorCodeOf,
  spreadsheetError,
  SPREADSHEET_ERRORS,
} from "../../../../src/plugins/spreadsheet/engine/spreadsheet-errors.ts";

describe("isSpreadsheetError", () => {
  it("recognises the Excel error strings", () => {
    assert.equal(isSpreadsheetError("#NUM!"), true);
    assert.equal(isSpreadsheetError("#DIV/0!"), true);
    assert.equal(isSpreadsheetError("#N/A"), true);
  });

  it("recognises every code in the taxonomy, including the engine's own #ERROR!", () => {
    assert.deepEqual(
      SPREADSHEET_ERRORS.filter((code) => !isSpreadsheetError(code)),
      [],
    );
  });

  it("rejects ordinary text and non-strings", () => {
    assert.equal(isSpreadsheetError("hello"), false);
    assert.equal(isSpreadsheetError("#NOPE!"), false);
    assert.equal(isSpreadsheetError(0), false);
    assert.equal(isSpreadsheetError(null), false);
  });
});

describe("errorCodeOf", () => {
  it("reads the code off an error value and off a string that spells one", () => {
    assert.equal(errorCodeOf(spreadsheetError("#REF!")), "#REF!");
    assert.equal(errorCodeOf("#REF!"), "#REF!");
  });

  it("is null for anything else", () => {
    assert.equal(errorCodeOf("#OOPS!"), null);
    assert.equal(errorCodeOf(7), null);
    assert.equal(errorCodeOf(undefined), null);
  });
});

describe("isErrorResult", () => {
  it("treats error values, NaN/∞ and missing values as errors", () => {
    assert.equal(isErrorResult(spreadsheetError("#DIV/0!")), true);
    assert.equal(isErrorResult(NaN), true);
    assert.equal(isErrorResult(Infinity), true);
    assert.equal(isErrorResult(null), true);
    assert.equal(isErrorResult(undefined), true);
  });

  it("passes ordinary values through", () => {
    assert.equal(isErrorResult(0), false);
    assert.equal(isErrorResult(42), false);
    assert.equal(isErrorResult("text"), false);
  });

  it("does NOT treat a string that merely spells an error as one (#2451)", () => {
    assert.equal(isErrorResult("#DIV/0!"), false);
    assert.equal(isErrorResult("#NUM!"), false);
  });
});
