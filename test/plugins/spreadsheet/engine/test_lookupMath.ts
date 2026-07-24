// isApproximateMatch reads VLOOKUP/HLOOKUP's range_lookup argument (#2360). The
// literal TRUE arrives as the STRING "TRUE" (the evaluator leaves bare words
// unquoted), which the old accept-only-`true|1|"1"` check missed and so fell
// back to exact match.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isApproximateMatch } from "../../../../src/plugins/spreadsheet/engine/functions/lookup-math.ts";

describe("isApproximateMatch", () => {
  it("treats a real boolean as itself", () => {
    assert.equal(isApproximateMatch(true), true);
    assert.equal(isApproximateMatch(false), false);
  });

  // The fix: the bare word TRUE evaluates to the string "TRUE", not a boolean.
  it("reads the string forms of TRUE/FALSE, case-insensitively", () => {
    assert.equal(isApproximateMatch("TRUE"), true);
    assert.equal(isApproximateMatch("true"), true);
    assert.equal(isApproximateMatch("True"), true);
    assert.equal(isApproximateMatch("FALSE"), false);
    assert.equal(isApproximateMatch("false"), false);
  });

  it("reads numeric logicals: 0 exact, non-zero approximate", () => {
    assert.equal(isApproximateMatch(1), true);
    assert.equal(isApproximateMatch(0), false);
    assert.equal(isApproximateMatch(2), true);
    assert.equal(isApproximateMatch("1"), true);
    assert.equal(isApproximateMatch("0"), false);
  });

  it("treats blank or stray text as exact (FALSE), matching Excel coercion", () => {
    assert.equal(isApproximateMatch(""), false);
    assert.equal(isApproximateMatch("  "), false);
    assert.equal(isApproximateMatch("yes"), false);
  });

  it("ignores surrounding whitespace on the string forms", () => {
    assert.equal(isApproximateMatch(" TRUE "), true);
    assert.equal(isApproximateMatch(" 0 "), false);
  });
});
