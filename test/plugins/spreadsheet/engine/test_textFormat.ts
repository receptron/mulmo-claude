// Excel number-format codes as read by the TEXT function.
//
// TEXT used to ignore the pattern's shape and hard-code its own: `#,##0`
// grouping was dropped entirely, and the `$` / `%` branches always produced two
// decimals — so `TEXT(1234.5,"$#,##0.00")` returned "$1234.50", `TEXT(0.5,"0%")`
// returned "50.00%" and `TEXT(5,"$0")` returned "$5.00". Every one of those is a
// plausible-looking string, which is why they survived (#2360).
//
// The pattern interpreter is tested directly; the end-to-end path through
// SpreadsheetEngine confirms the TEXT handler wires it up.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatWithPattern, parseNumberPattern } from "../../../../src/plugins/spreadsheet/engine/textFormat.ts";
import { groupThousands } from "../../../../src/plugins/spreadsheet/engine/formatter.ts";
import { SpreadsheetEngine } from "../../../../src/plugins/spreadsheet/engine/index.ts";

const engine = new SpreadsheetEngine();
const evalFormula = (formula: string): unknown => engine.calculate(engine.createSheet("S", [[`=${formula}`]])).data[0][0];

describe("formatWithPattern — the cases reported in #2360", () => {
  it("groups digits for a currency pattern", () => {
    assert.equal(formatWithPattern(1234.5, "$#,##0.00"), "$1,234.50");
  });

  it("takes the percent decimals from the pattern instead of forcing two", () => {
    assert.equal(formatWithPattern(0.5, "0%"), "50%");
  });

  it("takes the currency decimals from the pattern instead of forcing two", () => {
    assert.equal(formatWithPattern(5, "$0"), "$5");
  });
});

describe("formatWithPattern — grouping boundaries", () => {
  it("leaves a three-digit number ungrouped", () => {
    assert.equal(formatWithPattern(999, "#,##0"), "999");
  });

  it("groups from four digits up", () => {
    assert.equal(formatWithPattern(1000, "#,##0"), "1,000");
  });

  it("groups every third digit of a large number", () => {
    assert.equal(formatWithPattern(1234567, "#,##0"), "1,234,567");
  });

  it("groups the carried digit when rounding crosses a boundary", () => {
    assert.equal(formatWithPattern(999.5, "#,##0"), "1,000");
  });

  it("omits grouping when the pattern has no comma", () => {
    assert.equal(formatWithPattern(1234567, "0"), "1234567");
  });
});

describe("formatWithPattern — negatives and zero", () => {
  it("puts the sign in front of the whole rendering, currency included", () => {
    assert.equal(formatWithPattern(-1234.5, "$#,##0.00"), "-$1,234.50");
  });

  it("keeps the sign on a grouped plain number", () => {
    assert.equal(formatWithPattern(-1234.5, "#,##0.00"), "-1,234.50");
  });

  it("renders zero with the pattern's decimals", () => {
    assert.equal(formatWithPattern(0, "$#,##0.00"), "$0.00");
  });

  // The sign follows the ROUNDED digits: a value that rounds away to zero must
  // not render as "-0.00", which reads as a negative amount that isn't there.
  it("drops the sign when rounding leaves nothing but zeros", () => {
    assert.equal(formatWithPattern(-0.001, "0.00"), "0.00");
  });

  it("keeps the sign when rounding leaves a non-zero digit", () => {
    assert.equal(formatWithPattern(-0.006, "0.00"), "-0.01");
  });
});

describe("formatWithPattern — decimals", () => {
  it("rounds to the pattern's fixed decimals", () => {
    assert.equal(formatWithPattern(1234.5678, "0.00"), "1234.57");
  });

  it("pads to the pattern's fixed decimals", () => {
    assert.equal(formatWithPattern(2, "0.000"), "2.000");
  });

  it("rounds to a whole number when the pattern has no decimal point", () => {
    assert.equal(formatWithPattern(1234.5, "0"), "1235");
  });

  it("drops an optional trailing decimal written as #", () => {
    assert.equal(formatWithPattern(0.5, "0.0#"), "0.5");
  });

  it("keeps an optional decimal that is not a trailing zero", () => {
    assert.equal(formatWithPattern(0.25, "0.0#"), "0.25");
  });

  it("drops every decimal when all of them are optional", () => {
    assert.equal(formatWithPattern(2, "0.##"), "2");
  });

  it("pads the whole part to the pattern's leading zeros", () => {
    assert.equal(formatWithPattern(5, "000"), "005");
  });
});

describe("formatWithPattern — percent", () => {
  it("scales by 100 and keeps the pattern's two decimals", () => {
    assert.equal(formatWithPattern(0.1234, "0.00%"), "12.34%");
  });

  it("scales a value above one", () => {
    assert.equal(formatWithPattern(1, "0%"), "100%");
  });

  it("groups a large percentage", () => {
    assert.equal(formatWithPattern(12.3456, "#,##0.0%"), "1,234.6%");
  });

  it("keeps the sign of a negative percentage", () => {
    assert.equal(formatWithPattern(-0.5, "0%"), "-50%");
  });
});

describe("formatWithPattern — literals", () => {
  it("keeps a leading literal", () => {
    assert.equal(formatWithPattern(1234.5, "USD #,##0.00"), "USD 1,234.50");
  });

  it("keeps a trailing literal", () => {
    assert.equal(formatWithPattern(1234.5, "#,##0.0 kg"), "1,234.5 kg");
  });
});

describe("formatWithPattern — formats it deliberately does not render", () => {
  it("declines a pattern with no digit placeholder", () => {
    assert.equal(formatWithPattern(1234.5, "MM/DD/YYYY"), null);
  });

  it("declines an empty pattern", () => {
    assert.equal(formatWithPattern(1234.5, ""), null);
  });

  it("declines scientific notation", () => {
    assert.equal(formatWithPattern(1234.5, "0.00E+00"), null);
  });

  it("declines a multi-section pattern, whose negative/zero sections it cannot honour", () => {
    assert.equal(formatWithPattern(-1, "0.00;(0.00)"), null);
  });

  it("declines a quoted literal", () => {
    assert.equal(formatWithPattern(1, '0" units"'), null);
  });

  it("declines a fraction pattern", () => {
    assert.equal(formatWithPattern(1.5, "# ?/?"), null);
  });

  // A comma AFTER the last placeholder means "scale by a thousand" in Excel;
  // rendering it as ordinary grouping would be off by 1000.
  it("declines the thousands-scaling trailing comma", () => {
    assert.equal(formatWithPattern(1234567, "#,##0,"), null);
  });

  it("declines a non-finite value", () => {
    assert.equal(formatWithPattern(NaN, "0.00"), null);
    assert.equal(formatWithPattern(Infinity, "0.00"), null);
  });
});

describe("parseNumberPattern", () => {
  it("splits a currency pattern into literal, grouping and decimals", () => {
    assert.deepEqual(parseNumberPattern("$#,##0.00"), {
      prefix: "$",
      suffix: "",
      useGrouping: true,
      integerMinDigits: 1,
      minDecimals: 2,
      maxDecimals: 2,
      isPercent: false,
    });
  });

  it("marks a trailing percent sign and counts optional decimals separately", () => {
    assert.deepEqual(parseNumberPattern("0.0#%"), {
      prefix: "",
      suffix: "%",
      useGrouping: false,
      integerMinDigits: 1,
      minDecimals: 1,
      maxDecimals: 2,
      isPercent: true,
    });
  });

  it("returns null for a code it cannot render", () => {
    assert.equal(parseNumberPattern("MMM D, YYYY"), null);
  });
});

describe("groupThousands", () => {
  it("returns short runs unchanged", () => {
    assert.equal(groupThousands(""), "");
    assert.equal(groupThousands("7"), "7");
    assert.equal(groupThousands("999"), "999");
  });

  it("separates every third digit from the right", () => {
    assert.equal(groupThousands("1000"), "1,000");
    assert.equal(groupThousands("1234567"), "1,234,567");
    assert.equal(groupThousands("100000000"), "100,000,000");
  });
});

describe("TEXT — end to end through SpreadsheetEngine", () => {
  it("groups digits for a currency pattern", () => {
    assert.equal(evalFormula('TEXT(1234.5,"$#,##0.00")'), "$1,234.50");
  });

  it("renders a bare percent pattern without inventing decimals", () => {
    assert.equal(evalFormula('TEXT(0.5,"0%")'), "50%");
  });

  it("renders a bare currency pattern without inventing decimals", () => {
    assert.equal(evalFormula('TEXT(5,"$0")'), "$5");
  });

  it("groups a large plain number", () => {
    assert.equal(evalFormula('TEXT(1234567,"#,##0")'), "1,234,567");
  });

  it("keeps the sign of a negative value", () => {
    assert.equal(evalFormula('TEXT(-1234.5,"#,##0.00")'), "-1,234.50");
  });

  it("formats a cell reference the same way", () => {
    const sheet = engine.createSheet("S", [[{ v: 1234.5 }, { v: '=TEXT(A1,"$#,##0.00")' }]]);
    assert.equal(engine.calculate(sheet).data[0][1], "$1,234.50");
  });

  it("returns the value's own text for a format code it does not render", () => {
    assert.equal(evalFormula('TEXT(1234.5,"MM/DD/YYYY")'), "1234.5");
  });

  it("passes non-numeric input through unchanged", () => {
    assert.equal(evalFormula('TEXT("abc","0.00")'), "abc");
  });
});
