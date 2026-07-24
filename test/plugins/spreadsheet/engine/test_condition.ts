// Reading a spreadsheet condition without running it. The grammar is one
// comparison or a bare value, and that narrowness is the safety property —
// this replaced an `eval` that executed whatever a cell happened to contain.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCondition,
  isTruthyCondition,
  readOperand,
  renderConditionOperand,
  splitComparison,
  stripOuterParens,
} from "../../../../src/plugins/spreadsheet/engine/condition.ts";

describe("splitComparison", () => {
  it("splits on each operator", () => {
    assert.deepEqual(splitComparison("A>1"), { left: "A", operator: ">", right: "1" });
    assert.deepEqual(splitComparison("A<1"), { left: "A", operator: "<", right: "1" });
    assert.deepEqual(splitComparison("A=1"), { left: "A", operator: "=", right: "1" });
  });

  // Longest-first matching: a `>` that starts `>=` must not win.
  it("prefers the two-character operators", () => {
    assert.deepEqual(splitComparison("A>=1"), { left: "A", operator: ">=", right: "1" });
    assert.deepEqual(splitComparison("A<=1"), { left: "A", operator: "<=", right: "1" });
    assert.deepEqual(splitComparison("A<>1"), { left: "A", operator: "<>", right: "1" });
    assert.deepEqual(splitComparison("A!=1"), { left: "A", operator: "!=", right: "1" });
    assert.deepEqual(splitComparison("A==1"), { left: "A", operator: "==", right: "1" });
  });

  it("trims both sides", () => {
    assert.deepEqual(splitComparison("  A  >  1  "), { left: "A", operator: ">", right: "1" });
  });

  it("returns null when there is no comparison", () => {
    assert.equal(splitComparison("A1"), null);
    assert.equal(splitComparison("42"), null);
    assert.equal(splitComparison(""), null);
  });

  // Only the first operator counts, so `a=b=c` is one comparison against the
  // text `b=c` rather than a chain. A chain is what used to reach a JS parser.
  it("takes only the first operator", () => {
    assert.deepEqual(splitComparison("1=1=1"), { left: "1", operator: "=", right: "1=1" });
  });

  // A blank cell substitutes to nothing, leaving the operator at position 0.
  // That is a comparison against an empty left side, not a bare value — reading
  // it as text made `IFS` pick branches for empty cells (Codex review).
  it("treats a leading operator as a comparison with an empty left side", () => {
    assert.deepEqual(splitComparison(">5"), { left: "", operator: ">", right: "5" });
    assert.deepEqual(splitComparison(">=1"), { left: "", operator: ">=", right: "1" });
  });

  // A cell holding `a>b` substitutes as the literal `"a>b"`. Splitting on that
  // `>` would compare two fragments of one string (Codex review). The same must
  // hold for `<` and `=` inside the operand, not only `>`.
  it("ignores operators inside quoted text", () => {
    assert.deepEqual(splitComparison('"a>b"="a>b"'), { left: '"a>b"', operator: "=", right: '"a>b"' });
    assert.deepEqual(splitComparison('"a<b"="a<b"'), { left: '"a<b"', operator: "=", right: '"a<b"' });
    assert.deepEqual(splitComparison("'x=y'='x=y'"), { left: "'x=y'", operator: "=", right: "'x=y'" });
    assert.deepEqual(splitComparison('A1="a>b"'), { left: "A1", operator: "=", right: '"a>b"' });
    assert.deepEqual(splitComparison('A1="a<b"'), { left: "A1", operator: "=", right: '"a<b"' });
  });

  it("finds an operator that follows a quoted section", () => {
    assert.deepEqual(splitComparison('"a>b" = "c"'), { left: '"a>b"', operator: "=", right: '"c"' });
  });
});

describe("stripOuterParens", () => {
  // `IFS((A1>0), ...)` is valid, and the parser used to split it into `(1` and
  // `0)` — two operands that compare as text and never match (Codex review).
  it("removes parentheses that wrap the whole expression", () => {
    assert.equal(stripOuterParens("(1>0)"), "1>0");
    assert.equal(stripOuterParens("((1>0))"), "1>0");
    assert.equal(stripOuterParens("  ( 1>0 )  "), "1>0");
  });

  // The leading `(` closes before the end, so it wraps only its own operand.
  // Removing the outer characters here would corrupt the expression into
  // `A)=(B`.
  it("keeps parentheses that wrap only part of the expression", () => {
    assert.equal(stripOuterParens("(A)=(B)"), "(A)=(B)");
    assert.equal(stripOuterParens("(1)>(0)"), "(1)>(0)");
  });

  it("leaves unbalanced input untouched rather than guessing", () => {
    assert.equal(stripOuterParens("(1>0"), "(1>0");
    assert.equal(stripOuterParens("("), "(");
    assert.equal(stripOuterParens(")("), ")(");
  });

  it("ignores parentheses inside quoted text", () => {
    assert.equal(stripOuterParens('("a)b")'), '"a)b"');
  });

  it("leaves an expression with no outer parentheses alone", () => {
    assert.equal(stripOuterParens("1>0"), "1>0");
    assert.equal(stripOuterParens(""), "");
  });
});

describe("readOperand", () => {
  it("reads numbers", () => {
    assert.equal(readOperand("42"), 42);
    assert.equal(readOperand("-3.5"), -3.5);
    assert.equal(readOperand("0"), 0);
  });

  it("reads booleans case-insensitively", () => {
    assert.equal(readOperand("TRUE"), true);
    assert.equal(readOperand("true"), true);
    assert.equal(readOperand("FALSE"), false);
  });

  it("keeps quoted text as text, quotes removed", () => {
    assert.equal(readOperand('"hello"'), "hello");
    assert.equal(readOperand("'hello'"), "hello");
    assert.equal(readOperand('"42"'), "42", "quoted digits stay text");
  });

  // `Number` rather than `parseFloat`: trailing garbage makes the whole thing
  // text instead of silently contributing its numeric prefix.
  it("does not take a numeric prefix from mixed text", () => {
    assert.equal(readOperand("12abc"), "12abc");
    assert.equal(readOperand("3.5kg"), "3.5kg");
  });

  it("keeps unquoted text as text", () => {
    assert.equal(readOperand("hello"), "hello");
    assert.equal(readOperand(""), "");
  });
});

describe("evaluateCondition — comparisons", () => {
  it("compares numbers", () => {
    assert.equal(evaluateCondition("5>3"), true);
    assert.equal(evaluateCondition("3>5"), false);
    assert.equal(evaluateCondition("5>=5"), true, "the boundary counts for >=");
    assert.equal(evaluateCondition("5>5"), false);
    assert.equal(evaluateCondition("3<=3"), true);
  });

  it("compares for equality and inequality", () => {
    assert.equal(evaluateCondition("5=5"), true);
    assert.equal(evaluateCondition("5==5"), true);
    assert.equal(evaluateCondition("5<>3"), true);
    assert.equal(evaluateCondition("5!=5"), false);
  });

  // The regression the quote-aware scan exists for: both sides are one string
  // each, so this is equality between them, not a comparison of fragments.
  it("evaluates a parenthesised comparison the same as a bare one", () => {
    assert.equal(evaluateCondition("(1>0)"), true);
    assert.equal(evaluateCondition("((5>=5))"), true);
    assert.equal(evaluateCondition("(3>5)"), false);
    assert.equal(evaluateCondition('("a"="a")'), true);
  });

  it("evaluates a parenthesised bare value", () => {
    assert.equal(evaluateCondition("(1)"), true);
    assert.equal(evaluateCondition("(0)"), false);
  });

  it("compares text containing operator characters", () => {
    assert.equal(evaluateCondition('"a>b"="a>b"'), true);
    assert.equal(evaluateCondition('"a>b"="a>c"'), false);
    assert.equal(evaluateCondition('"a<b"="a<b"'), true, "the inner < is data, not a comparison");
    assert.equal(evaluateCondition('"a<b"="a<c"'), false);
    assert.equal(evaluateCondition('"a=b"="a=b"'), true, "the inner = is data, not a comparison");
  });

  it("compares an empty left side, as a blank cell produces", () => {
    assert.equal(evaluateCondition(">5"), false, "blank is not greater than 5");
    assert.equal(evaluateCondition(">=1"), false);
    assert.equal(evaluateCondition("<>5"), true, "blank does differ from 5");
    assert.equal(evaluateCondition("=5"), false);
    assert.equal(evaluateCondition('=""'), true, "blank equals blank");
  });

  it("compares text", () => {
    assert.equal(evaluateCondition('"abc"="abc"'), true);
    assert.equal(evaluateCondition('"abc"="abd"'), false);
    assert.equal(evaluateCondition('"abc"<"abd"'), true);
  });

  // A quoted number and a bare one are different types, so equality separates
  // them — the same rule the rest of the engine follows.
  it("distinguishes a quoted number from a bare one", () => {
    assert.equal(evaluateCondition('42="42"'), false);
  });

  it("compares booleans for equality but refuses to order them", () => {
    assert.equal(evaluateCondition("TRUE=TRUE"), true);
    assert.equal(evaluateCondition("TRUE<>FALSE"), true);
    assert.equal(evaluateCondition("TRUE>FALSE"), false, "no ordering is defined");
  });
});

describe("evaluateCondition — bare values", () => {
  // Spreadsheet truthiness, not JavaScript's: 0 and empty are false.
  it("treats zero and empty as false, other values as true", () => {
    assert.equal(evaluateCondition("0"), false);
    assert.equal(evaluateCondition(""), false);
    assert.equal(evaluateCondition('""'), false);
    assert.equal(evaluateCondition("1"), true);
    assert.equal(evaluateCondition("-1"), true, "a negative number is still a value");
    assert.equal(evaluateCondition("hello"), true);
  });

  it("reads bare booleans", () => {
    assert.equal(isTruthyCondition("TRUE"), true);
    assert.equal(isTruthyCondition("FALSE"), false);
  });
});

describe("evaluateCondition — code is data", () => {
  // The point of the module. Each of these used to execute (#2360): the first
  // two as a cell's substituted value, the third as text written straight into
  // the formula. They must now be read as operands and nothing more.
  it("does not execute an assignment", () => {
    const marker = globalThis as Record<string, unknown>;
    marker.__conditionProbe = false;
    assert.equal(evaluateCondition("globalThis.__conditionProbe=true"), false, "an assignment is text, and text is not a comparison match");
    assert.equal(marker.__conditionProbe, false, "nothing ran");
  });

  it("does not execute a call or a sequence", () => {
    const marker = globalThis as Record<string, unknown>;
    marker.__conditionProbe2 = false;
    evaluateCondition("(globalThis.__conditionProbe2=true, 1)>0");
    assert.equal(marker.__conditionProbe2, false);
  });

  it("does not honour a logical operator smuggled into the condition", () => {
    const marker = globalThis as Record<string, unknown>;
    marker.__conditionProbe3 = false;
    evaluateCondition("1>0&&(globalThis.__conditionProbe3=true)");
    assert.equal(marker.__conditionProbe3, false);
  });

  it("never throws on syntactically broken input", () => {
    for (const input of ["((((", '"unclosed', "1+", "}{", "throw 1"]) {
      assert.equal(typeof evaluateCondition(input), "boolean", `${input} should still yield a boolean`);
    }
  });
});

describe("renderConditionOperand", () => {
  it("renders numbers and booleans as themselves", () => {
    assert.equal(renderConditionOperand(42), "42");
    assert.equal(renderConditionOperand(0), "0");
    assert.equal(renderConditionOperand(true), "true");
  });

  // A text cell must arrive as a quoted literal, so its own contents cannot be
  // read as operators: `x>y` unquoted would make `A1="x>y"` parse as a
  // comparison of fragments.
  it("quotes strings", () => {
    assert.equal(renderConditionOperand("x>y"), '"x>y"');
    assert.equal(renderConditionOperand("Yes"), '"Yes"');
    assert.equal(renderConditionOperand(""), '""');
  });

  it("escapes quotes and backslashes so the literal cannot be closed early", () => {
    assert.equal(renderConditionOperand('a"b'), '"a\\"b"');
    assert.equal(renderConditionOperand("a\\b"), '"a\\\\b"');
  });

  it("renders a missing value as an empty quoted string", () => {
    assert.equal(renderConditionOperand(null), '""');
    assert.equal(renderConditionOperand(undefined), '""');
  });

  // Round-trip: whatever it renders, evaluateCondition reads back as the same
  // value, so a quoted text operand compares equal to itself.
  it("round-trips through evaluateCondition", () => {
    assert.equal(evaluateCondition(`${renderConditionOperand("x>y")}="x>y"`), true);
    assert.equal(evaluateCondition(`${renderConditionOperand("x>y")}="other"`), false);
  });

  // A literal backslash must survive the escape-on-render / unescape-on-read
  // round-trip exactly once: the earlier substitution path escaped it twice
  // (CodeQL js/double-escaping), which corrupted the operand.
  it("round-trips a value holding a backslash without double-escaping", () => {
    assert.equal(readOperand(renderConditionOperand("a\\b")), "a\\b");
    assert.equal(evaluateCondition(`${renderConditionOperand("a\\b")}=${renderConditionOperand("a\\b")}`), true);
    assert.equal(evaluateCondition(`${renderConditionOperand("a\\b")}=${renderConditionOperand("a/b")}`), false);
  });
});
