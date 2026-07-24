// Domain and boundary rules for the math functions. The bugs here returned a
// plausible NUMBER (FLOOR(-2.5,2) = -4, ROUND(-2.5,0) = -2, MOD(-3,2) = -1) or a
// silent NaN/∞ instead of an Excel error (#2389). The rounding direction, the
// modulo sign and the domain guards are checked directly on the pure helpers,
// with a few end-to-end checks that the handlers surface the error values.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  roundTo,
  roundUpTo,
  roundDownTo,
  floorToSignificance,
  ceilingToSignificance,
  modulo,
  power,
  safeLog,
  safeLog10,
  safeSqrt,
  logWithBase,
} from "../../../../src/plugins/spreadsheet/engine/math-ops.ts";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";
import { DIV_ZERO_ERROR, NUM_ERROR } from "../../../../src/plugins/spreadsheet/engine/spreadsheet-errors.ts";

const closeTo = (actual: number, expected: number, eps = 1e-9): boolean => Math.abs(actual - expected) <= eps;

describe("roundTo / roundUpTo / roundDownTo — direction", () => {
  it("rounds half away from zero, not toward +infinity", () => {
    assert.equal(roundTo(-2.5, 0), -3);
    assert.equal(roundTo(2.5, 0), 3);
    assert.ok(closeTo(roundTo(0.125, 2), 0.13));
  });

  it("rounds up away from zero", () => {
    assert.ok(closeTo(roundUpTo(-3.14159, 2), -3.15));
    assert.ok(closeTo(roundUpTo(3.14159, 2), 3.15));
  });

  it("rounds down toward zero", () => {
    assert.ok(closeTo(roundDownTo(-3.14159, 2), -3.14));
    assert.ok(closeTo(roundDownTo(3.19, 1), 3.1));
  });
});

describe("floorToSignificance / ceilingToSignificance — sign domain", () => {
  it("is a #NUM! error value when number and significance disagree in sign", () => {
    assert.equal(floorToSignificance(-2.5, 2), NUM_ERROR);
    assert.equal(ceilingToSignificance(2.5, -2), NUM_ERROR);
  });

  it("rounds to the multiple when the signs match", () => {
    assert.equal(floorToSignificance(2.5, 2), 2);
    assert.equal(floorToSignificance(-2.5, -2), -2);
    assert.equal(ceilingToSignificance(2.5, 2), 4);
    assert.equal(ceilingToSignificance(-2.5, -2), -4);
  });

  it("returns 0 for a zero value", () => {
    assert.equal(floorToSignificance(0, 2), 0);
    assert.equal(ceilingToSignificance(0, 2), 0);
  });

  // Excel is deliberately asymmetric here: FLOOR(x, 0) is #DIV/0! while
  // CEILING(x, 0) is 0. Both used to answer 0, so FLOOR swallowed a divide-by-
  // zero (#2360). Keep the pair pinned so neither is "made consistent" later.
  it("is #DIV/0! for FLOOR with a zero significance, but 0 for CEILING", () => {
    assert.equal(floorToSignificance(3, 0), DIV_ZERO_ERROR);
    assert.equal(ceilingToSignificance(3, 0), 0);
  });

  // The zero check has to win over the sign check, or a negative number with a
  // zero significance would report the wrong error (#NUM! instead of #DIV/0!).
  it("reports #DIV/0! rather than #NUM! for a negative number over a zero significance", () => {
    assert.equal(floorToSignificance(-3, 0), DIV_ZERO_ERROR);
  });
});

describe("modulo — divisor sign and division by zero", () => {
  it("takes the sign of the divisor", () => {
    assert.equal(modulo(-3, 2), 1);
    assert.equal(modulo(3, -2), -1);
    assert.equal(modulo(-3, -2), -1);
    assert.equal(modulo(5, 3), 2);
  });

  it("is #DIV/0! when the divisor is zero", () => {
    assert.equal(modulo(5, 0), DIV_ZERO_ERROR);
  });
});

describe("power — negative base domain", () => {
  it("is #NUM! for a negative base with a non-integer exponent", () => {
    assert.equal(power(-8, 1 / 3), NUM_ERROR);
    assert.equal(power(-2, 0.5), NUM_ERROR);
  });

  it("computes when the exponent is an integer or the base is non-negative", () => {
    assert.equal(power(-2, 3), -8);
    assert.equal(power(2, 10), 1024);
    assert.ok(closeTo(power(9, 0.5) as number, 3));
  });
});

describe("safeSqrt / safeLog / safeLog10 — domain", () => {
  it("is #NUM! outside the domain", () => {
    assert.equal(safeSqrt(-1), NUM_ERROR);
    assert.equal(safeLog(0), NUM_ERROR);
    assert.equal(safeLog(-1), NUM_ERROR);
    assert.equal(safeLog10(0), NUM_ERROR);
  });

  it("computes inside the domain", () => {
    assert.equal(safeSqrt(4), 2);
    assert.ok(closeTo(safeLog(Math.E) as number, 1));
    assert.equal(safeLog10(1000), 3);
  });
});

describe("logWithBase — number and base domain", () => {
  it("computes a valid base-N log", () => {
    assert.ok(closeTo(logWithBase(8, 2) as number, 3));
    assert.ok(closeTo(logWithBase(100, 10) as number, 2));
  });

  it("is #NUM! for a non-positive number", () => {
    assert.equal(logWithBase(0, 10), NUM_ERROR);
    assert.equal(logWithBase(-1, 10), NUM_ERROR);
  });

  it("is #NUM! for a base that is non-positive or exactly 1", () => {
    assert.equal(logWithBase(8, 1), NUM_ERROR);
    assert.equal(logWithBase(8, -2), NUM_ERROR);
    assert.equal(logWithBase(8, 0), NUM_ERROR);
  });
});

describe("the handlers surface the errors end-to-end", () => {
  const evalFormula = (formula: string): unknown => new SpreadsheetEngine().calculate({ name: "S", data: [[{ v: formula }]] } satisfies SheetData).data[0][0];

  it("displays the Excel error codes through the engine", () => {
    assert.equal(evalFormula("=FLOOR(-2.5, 2)"), "#NUM!");
    assert.equal(evalFormula("=FLOOR(3, 0)"), "#DIV/0!");
    assert.equal(evalFormula("=CEILING(3, 0)"), 0);
    assert.equal(evalFormula("=SQRT(-1)"), "#NUM!");
    assert.equal(evalFormula("=MOD(5, 0)"), "#DIV/0!");
    assert.equal(evalFormula("=ROUND(-2.5, 0)"), -3);
    assert.equal(evalFormula("=MOD(-3, 2)"), 1);
    assert.equal(evalFormula("=LOG(8, 1)"), "#NUM!");
    assert.equal(evalFormula("=LOG(8, -2)"), "#NUM!");
    assert.equal(evalFormula("=LOG(8, 2)"), 3);
  });

  // Domain misses are error VALUES (not NaN/∞), so IFERROR must still catch
  // them or nested formulas would surface the raw error (#2389 review).
  it("lets IFERROR catch the domain errors", () => {
    assert.equal(evalFormula("=IFERROR(SQRT(-1), 42)"), 42);
    assert.equal(evalFormula("=IFERROR(MOD(5, 0), -1)"), -1);
    assert.equal(evalFormula("=IFERROR(SQRT(4), 42)"), 2, "a non-error passes through");
  });

  // Text that only looks like an error is real text, not an error value, so
  // IFERROR returns it rather than the fallback.
  it("does not treat quoted error-looking text as an error", () => {
    assert.equal(evalFormula('=IFERROR("#NUM!", 42)'), "#NUM!");
    assert.equal(evalFormula('=IFERROR("hello", 42)'), "hello");
  });
});
