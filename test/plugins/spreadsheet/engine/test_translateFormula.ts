// Excel-formula → JS-expression translation. These are the pure string
// transforms the evaluator runs on an already-substituted expression before
// handing it to `new Function`. A mistranslated operator can still produce a
// plausible wrong NUMBER (`=2^3^2` = 512, not 64 — the associativity gap tracked
// by the sibling issues). What #2359 fixed: a formula that reaches `new Function`
// as invalid JS (`=5<>6`) no longer comes back as its raw text — it surfaces as
// an #ERROR!. This suite pins both the remaining known-wrong number cases and the
// post-#2359 error surfacing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  caretToPow,
  replaceConcatOperator,
  rewriteComparisonEq,
  isSafeArithmetic,
  isSafeComparison,
  SpreadsheetEngine,
  type SheetData,
} from "../../../../src/plugins/spreadsheet/engine/index.ts";

describe("caretToPow", () => {
  it("rewrites a single caret to the JS exponentiation operator", () => {
    assert.equal(caretToPow("2^3"), "2**3");
  });

  it("rewrites every caret in the expression", () => {
    assert.equal(caretToPow("2^3+4^5"), "2**3+4**5");
    assert.equal(caretToPow("A^B^C"), "A**B**C");
  });

  // Excel's `^` is LEFT-associative (`2^3^2` = `(2^3)^2` = 64); JS `**` is
  // RIGHT-associative (`2**3**2` = `2**(3**2)` = 512). This transform is a plain
  // substitution and does NOT bridge that difference — a chained caret keeps
  // producing the JS answer. Pinned as a known limitation (#2359).
  it("does not correct the left-vs-right associativity of chained carets", () => {
    assert.equal(caretToPow("2^3^2"), "2**3**2");
    assert.equal(new Function("return (2**3**2)")(), 512, "JS is right-associative, so 512 not 64");
  });

  it("leaves an expression with no caret unchanged", () => {
    assert.equal(caretToPow("2+3*4"), "2+3*4");
    assert.equal(caretToPow(""), "");
  });
});

describe("replaceConcatOperator", () => {
  it("rewrites a concatenation ampersand to +", () => {
    assert.equal(replaceConcatOperator('"a"&"b"'), '"a"+"b"');
    assert.equal(replaceConcatOperator("5&6"), "5+6");
  });

  it("rewrites every ampersand outside string literals", () => {
    assert.equal(replaceConcatOperator('"a"&"b"&"c"'), '"a"+"b"+"c"');
  });

  // An ampersand INSIDE a literal is text, not an operator — flipping it would
  // corrupt the string content.
  it("preserves an ampersand inside a double-quoted literal", () => {
    assert.equal(replaceConcatOperator('"a&b"&"c"'), '"a&b"+"c"');
  });

  it("preserves an ampersand inside a single-quoted literal", () => {
    assert.equal(replaceConcatOperator("'a&b'&'c'"), "'a&b'+'c'");
  });

  // A backslash-escaped quote does not end the literal, so an ampersand after it
  // is still inside the string and must be preserved.
  it("honours a backslash-escaped quote when tracking literal boundaries", () => {
    assert.equal(replaceConcatOperator('"a\\"&b"&"c"'), '"a\\"&b"+"c"');
  });

  it("leaves an expression with no ampersand unchanged", () => {
    assert.equal(replaceConcatOperator("2+3"), "2+3");
    assert.equal(replaceConcatOperator('"plain"'), '"plain"');
    assert.equal(replaceConcatOperator(""), "");
  });

  it("rewrites a leading or trailing ampersand outside a literal", () => {
    assert.equal(replaceConcatOperator('&"x"'), '+"x"');
    assert.equal(replaceConcatOperator('"x"&'), '"x"+');
  });
});

describe("rewriteComparisonEq", () => {
  it("rewrites a single equality to the JS == operator", () => {
    assert.equal(rewriteComparisonEq("5=5"), "5==5");
    assert.equal(rewriteComparisonEq("5=6"), "5==6");
  });

  it("does not disturb <=, >= or != which are already valid JS", () => {
    assert.equal(rewriteComparisonEq("5<=6"), "5<=6");
    assert.equal(rewriteComparisonEq("5>=6"), "5>=6");
    assert.equal(rewriteComparisonEq("5!=6"), "5!=6");
  });

  // The regex matches the SECOND `=` of a `==` (its left neighbour, the first
  // `=`, is not one of `<>!`), so an already-doubled `==` becomes `===`. Excel
  // never emits `==`, so this only bites a hand-typed oddity — pinned as a known
  // quirk (#2359) rather than relied upon.
  it("turns an already-doubled == into === (known quirk)", () => {
    assert.equal(rewriteComparisonEq("5==6"), "5===6");
  });

  // The match consumes both flanking characters, so replacements cannot overlap:
  // in `5=6=7` only the first `=` is rewritten. Pinned as a known limitation
  // (#2359) — the non-overlapping replacement is a real bug to be fixed later.
  it("rewrites only the first of two adjacent equalities (non-overlapping)", () => {
    assert.equal(rewriteComparisonEq("5=6=7"), "5==6=7");
  });

  // A `=` with nothing on one side has no flanking character to match, so it is
  // left as a lone `=`. Pinned known limitation (#2359).
  it("does not rewrite an = at the start or end of the expression", () => {
    assert.equal(rewriteComparisonEq("=5"), "=5");
    assert.equal(rewriteComparisonEq("5="), "5=");
  });

  it("leaves an expression with no equals unchanged", () => {
    assert.equal(rewriteComparisonEq("5<6"), "5<6");
    assert.equal(rewriteComparisonEq(""), "");
  });
});

describe("isSafeArithmetic", () => {
  it("accepts digits, arithmetic operators, parentheses, dot and space", () => {
    assert.equal(isSafeArithmetic("2+3*4"), true);
    assert.equal(isSafeArithmetic("(2 + 3) / 4.5"), true);
    assert.equal(isSafeArithmetic("2**3"), true, "** survives the caret rewrite and must pass");
  });

  it("rejects letters, quotes, ampersands and comparison characters", () => {
    assert.equal(isSafeArithmetic("A1+2"), false);
    assert.equal(isSafeArithmetic('"a"+"b"'), false);
    assert.equal(isSafeArithmetic("5&6"), false);
    assert.equal(isSafeArithmetic("5<6"), false);
    assert.equal(isSafeArithmetic("5=6"), false);
  });

  // The allowlist requires at least one character, so the empty string is not
  // "safe" — there is nothing to evaluate.
  it("rejects the empty string", () => {
    assert.equal(isSafeArithmetic(""), false);
  });
});

describe("isSafeComparison", () => {
  it("accepts the arithmetic set plus < > ! =", () => {
    assert.equal(isSafeComparison("5<=6"), true);
    assert.equal(isSafeComparison("5<>6"), true, "the raw Excel <> passes the gate even though JS rejects it");
    assert.equal(isSafeComparison("(2**3) >= 6"), true);
  });

  it("rejects letters, quotes and ampersands", () => {
    assert.equal(isSafeComparison("A1<6"), false);
    assert.equal(isSafeComparison('"a"="b"'), false);
    assert.equal(isSafeComparison("5&6"), false);
  });

  it("rejects the empty string", () => {
    assert.equal(isSafeComparison(""), false);
  });
});

// End-to-end characterization: the pure functions compose inside the evaluator
// to the exact behaviour observed before the extraction. Includes the
// intentionally-wrong cases so the eventual #2359 fix shows up as a diff here.
describe("translation through the engine (characterization)", () => {
  const calc = (formula: string): unknown => new SpreadsheetEngine().calculate({ name: "S", data: [[{ v: formula }]] } satisfies SheetData).data[0][0];

  it("exponentiates (and keeps the JS-associativity quirk)", () => {
    assert.equal(calc("=2^3"), 8);
    assert.equal(calc("=2^3^2"), 512);
  });

  it("evaluates equality and the ordering comparisons", () => {
    assert.equal(calc("=5=5"), true);
    assert.equal(calc("=5=6"), false);
    assert.equal(calc("=5<=6"), true);
    assert.equal(calc("=5>=6"), false);
  });

  // `<>` is Excel's not-equal; it is not translated, so it reaches `new Function`
  // as invalid JS and throws. Post-#2359 that throw surfaces as #ERROR! rather
  // than the raw formula text (translating `<>` itself is a sibling issue).
  it("surfaces the untranslated <> operator as #ERROR!, not raw text", () => {
    assert.equal(calc("=5<>6"), "#ERROR!");
  });

  it("concatenates strings and mixed operands", () => {
    assert.equal(calc('="a"&"b"'), "ab");
    assert.equal(calc('="x"&5'), "x5");
  });

  it("evaluates plain arithmetic", () => {
    assert.equal(calc("=2*3+1"), 7);
    assert.equal(calc("=(2+3)*4"), 20);
  });
});
