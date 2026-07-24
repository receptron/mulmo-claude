// Criteria matching for COUNTIF / SUMIF / AVERAGEIF. Both bugs undercounted
// silently: text was compared with `===`, so `"yes"` skipped a cell holding
// `Yes`, and `"A*"` was matched literally instead of as a wildcard (#2360).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCriteria } from "../../../../src/plugins/spreadsheet/engine/registry.ts";
import { SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

describe("parseCriteria — text is matched case-insensitively", () => {
  it("matches regardless of case", () => {
    const matches = parseCriteria("yes");
    assert.equal(matches("Yes"), true);
    assert.equal(matches("YES"), true);
    assert.equal(matches("yes"), true);
  });

  it("still rejects different text", () => {
    const matches = parseCriteria("yes");
    assert.equal(matches("no"), false);
    assert.equal(matches("yesterday"), false, "an exact match, not a prefix");
  });
});

describe("parseCriteria — wildcards", () => {
  it("treats * as any run of characters", () => {
    const matches = parseCriteria("A*");
    assert.equal(matches("Axle"), true);
    assert.equal(matches("A"), true, "* may match nothing");
    assert.equal(matches("Bar"), false);
  });

  it("treats ? as exactly one character", () => {
    const matches = parseCriteria("b?t");
    assert.equal(matches("bat"), true);
    assert.equal(matches("bt"), false);
    assert.equal(matches("beat"), false);
  });

  it("escapes a wildcard with ~", () => {
    const matches = parseCriteria("A~*");
    assert.equal(matches("A*"), true);
    assert.equal(matches("Axle"), false);
  });

  it("does not let regex metacharacters act as a pattern", () => {
    const matches = parseCriteria("a.c");
    assert.equal(matches("a.c"), true);
    assert.equal(matches("abc"), false, "the dot is literal, not any-char");
  });
});

describe("parseCriteria — numbers and operators", () => {
  it("matches a numeric criteria against a number", () => {
    const matches = parseCriteria("5");
    assert.equal(matches(5), true);
    assert.equal(matches("5"), true);
    assert.equal(matches(6), false);
  });

  it("keeps the comparison operators working", () => {
    assert.equal(parseCriteria(">3")(5), true);
    assert.equal(parseCriteria(">3")(2), false);
    assert.equal(parseCriteria("<=3")(3), true);
  });

  it("applies case-insensitive text to = and <>", () => {
    assert.equal(parseCriteria("=yes")("Yes"), true);
    assert.equal(parseCriteria("<>yes")("Yes"), false);
    assert.equal(parseCriteria("<>yes")("no"), true);
  });
});

describe("COUNTIF through the engine", () => {
  const countif = (values: string[], criteria: string): unknown => {
    const rows = values.map((value) => [{ v: value }]);
    rows.push([{ v: `=COUNTIF(A1:A${values.length}, "${criteria}")` }]);
    const sheet: SheetData = { name: "S", data: rows };
    return new SpreadsheetEngine().calculate(sheet).data[values.length][0];
  };

  it("counts a case-differing match", () => {
    assert.equal(countif(["Yes", "no"], "yes"), 1);
  });

  it("counts a wildcard match", () => {
    assert.equal(countif(["Axle", "Bar"], "A*"), 1);
  });
});
