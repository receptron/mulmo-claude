// Deciding whether a string-concatenation expression is safe to evaluate. The
// bug this guards: the old check ran a character allowlist over the WHOLE
// expression, including the content of string literals — so a `!` inside a
// string, or the `\` an escaped operand produces, made a valid formula look
// unsafe and it was returned as raw text (#2376). Masking the literals first
// validates the structure without judging the content.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskStringLiterals, isSafeConcatExpression, SpreadsheetEngine, type SheetData } from "../../../../src/plugins/spreadsheet/engine/index.ts";

describe("maskStringLiterals", () => {
  it("empties a double- or single-quoted literal, keeping the quotes", () => {
    assert.equal(maskStringLiterals('"hello"'), '""');
    assert.equal(maskStringLiterals("'world'"), "''");
  });

  it("keeps the structure around the literals", () => {
    assert.equal(maskStringLiterals('"a"+"b"'), '""+""');
    assert.equal(maskStringLiterals('5+"x"'), '5+""');
  });

  // The content is what must not leak into the structure check — punctuation,
  // operators, whatever.
  it("removes arbitrary content, including operators and punctuation", () => {
    assert.equal(maskStringLiterals('"a>b!c"'), '""');
    assert.equal(maskStringLiterals('"1+2"+3'), '""+3');
  });

  // An escaped quote does not end the literal, so its content — and the
  // backslash — is masked away rather than leaking a stray quote.
  it("honours backslash escapes inside a literal", () => {
    assert.equal(maskStringLiterals('"a\\"b"'), '""');
    assert.equal(maskStringLiterals('"back\\\\slash"'), '""');
  });

  it("leaves an expression with no literals unchanged", () => {
    assert.equal(maskStringLiterals("1+2+3"), "1+2+3");
    assert.equal(maskStringLiterals(""), "");
  });
});

describe("isSafeConcatExpression", () => {
  it("accepts joined string literals", () => {
    assert.equal(isSafeConcatExpression('"a"+"b"'), true);
    assert.equal(isSafeConcatExpression('"hi"+"!"'), true, "a bang inside a string is content, not structure");
  });

  it("accepts a literal carrying escapes and arbitrary characters", () => {
    assert.equal(isSafeConcatExpression('"say \\"hi\\""+"!"'), true);
    assert.equal(isSafeConcatExpression('"a\\\\b"+"c"'), true);
    assert.equal(isSafeConcatExpression('"日本語"+"!"'), true);
  });

  it("accepts numbers and parentheses joining strings", () => {
    assert.equal(isSafeConcatExpression('5+"x"'), true);
    assert.equal(isSafeConcatExpression('("a")+("b")'), true);
  });

  // Once the literals are masked, an identifier in the STRUCTURE is not
  // allowed — that would be an unresolved reference or injected code.
  it("rejects an unresolved identifier in the structure", () => {
    assert.equal(isSafeConcatExpression('foo+"a"'), false);
    assert.equal(isSafeConcatExpression('"a"+process'), false);
  });

  // A boolean cell renders as a bare `true` / `false`; those two words must
  // pass or a boolean operand's concat is returned as raw text (Codex review).
  // Any other identifier — even one containing them as a substring — is still
  // rejected, so the exemption cannot smuggle code into `new Function`.
  it("accepts the boolean operand words but nothing else", () => {
    assert.equal(isSafeConcatExpression('true+"!"'), true);
    assert.equal(isSafeConcatExpression('false+"!"'), true);
    assert.equal(isSafeConcatExpression('truthy+"!"'), false);
  });
});

describe("string concatenation through the engine (#2376)", () => {
  const concat = (cellValue: string): unknown =>
    new SpreadsheetEngine().calculate({ name: "S", data: [[{ v: cellValue }, { v: '=A1&"!"' }]] } satisfies SheetData).data[0][1];

  // The plain case that was already broken: a `!` in the appended string made
  // the whole concat fail the allowlist and return the raw formula text.
  it("appends a literal to a plain string", () => {
    assert.equal(concat("hi"), "hi!");
  });

  // The #2376 blocker: an escaped operand must survive the concat path.
  it("appends to a string containing a quote", () => {
    assert.equal(concat('say "hi"'), 'say "hi"!');
  });

  it("appends to a string containing a backslash", () => {
    assert.equal(concat("a\\b"), "a\\b!");
  });

  it("appends to a numeric string", () => {
    assert.equal(concat("5"), "5!");
  });

  // A boolean operand (here A1 is the comparison `=1=1`) renders as `true`,
  // which the stricter safety gate used to reject — the concat came back as the
  // raw formula text instead of the joined value (Codex review).
  it("appends a literal to a boolean cell value", () => {
    const sheet: SheetData = { name: "S", data: [[{ v: "=1=1" }, { v: '=A1&"!"' }]] };
    assert.equal(new SpreadsheetEngine().calculate(sheet).data[0][1], "true!");
  });
});
