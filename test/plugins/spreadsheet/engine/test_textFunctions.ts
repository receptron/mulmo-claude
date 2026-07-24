// Edge-case behaviour of the SUBSTITUTE / RIGHT / LEFT / PROPER text functions.
//
// Each fix targets a case that fails silently: SUBSTITUTE with an empty
// old_text inserted the replacement between every character, a non-positive
// instance was ignored instead of erroring, RIGHT/LEFT turned a negative count
// into an empty string, and PROPER only broke words on spaces — all returning a
// plausible-looking string rather than the Excel result or a #VALUE! error.
//
// The pure helpers are tested directly; the end-to-end path through
// SpreadsheetEngine confirms the handlers wire them up.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { substituteText, takeLeft, takeRight, toProperCase } from "../../../../src/plugins/spreadsheet/engine/functions/text.ts";
import { SpreadsheetEngine } from "../../../../src/plugins/spreadsheet/engine/index.ts";
import { VALUE_ERROR } from "../../../../src/plugins/spreadsheet/engine/spreadsheet-errors.ts";

// The engine's display pass renders an error VALUE back to its code, so the
// end-to-end assertions compare against the string a cell shows.
const VALUE_ERROR_TEXT = VALUE_ERROR.code;

const engine = new SpreadsheetEngine();
const evalFormula = (formula: string): unknown => engine.calculate(engine.createSheet("S", [[`=${formula}`]])).data[0][0];

describe("substituteText — empty old_text", () => {
  it("returns the text unchanged instead of inserting between characters", () => {
    assert.equal(substituteText("abc", "", "-"), "abc");
  });

  it("stays unchanged even when an instance is supplied", () => {
    assert.equal(substituteText("abc", "", "-", 1), "abc");
  });

  it("stays unchanged for an empty text as well", () => {
    assert.equal(substituteText("", "", "-"), "");
  });
});

describe("substituteText — instance validation", () => {
  it("errors when the instance is zero", () => {
    assert.equal(substituteText("aa", "a", "b", 0), VALUE_ERROR);
  });

  it("errors when the instance is negative", () => {
    assert.equal(substituteText("aa", "a", "b", -1), VALUE_ERROR);
  });

  it("errors when the instance is not a finite number", () => {
    assert.equal(substituteText("aa", "a", "b", NaN), VALUE_ERROR);
  });

  it("truncates a fractional instance toward zero, so <1 errors", () => {
    assert.equal(substituteText("aa", "a", "b", 0.9), VALUE_ERROR);
    assert.equal(substituteText("aaa", "a", "b", 1.9), "baa", "1.9 truncates to the 1st occurrence");
  });
});

describe("substituteText — replacing occurrences", () => {
  it("replaces every occurrence when no instance is given", () => {
    assert.equal(substituteText("Hello World", "World", "Earth"), "Hello Earth");
    assert.equal(substituteText("a-b-c", "-", "+"), "a+b+c");
  });

  it("replaces only the requested 1-based occurrence", () => {
    assert.equal(substituteText("a-b-c", "-", "+", 1), "a+b-c");
    assert.equal(substituteText("a-b-c", "-", "+", 2), "a-b+c");
  });

  it("returns the text unchanged when the instance exceeds the occurrence count", () => {
    assert.equal(substituteText("a-b-c", "-", "+", 3), "a-b-c");
  });

  it("keeps matches non-overlapping like the replace-all path", () => {
    // "aa" occurs once in "aaa" when scanned non-overlapping, so a 2nd instance
    // does not exist and the text is returned unchanged.
    assert.equal(substituteText("aaa", "aa", "b", 2), "aaa");
    assert.equal(substituteText("aaa", "aa", "b", 1), "ba");
  });
});

describe("takeRight — negative count is an error", () => {
  it("errors on a negative count instead of returning an empty string", () => {
    assert.equal(takeRight("Hello", -1), VALUE_ERROR);
    assert.equal(takeRight("Hello", -0.5), VALUE_ERROR);
  });

  it("returns an empty string for a zero count", () => {
    assert.equal(takeRight("Hello", 0), "");
  });

  it("returns the whole string when the count exceeds its length", () => {
    assert.equal(takeRight("Hello", 10), "Hello");
  });

  it("returns the rightmost characters for a normal count", () => {
    assert.equal(takeRight("Hello", 2), "lo");
  });

  it("truncates a fractional count toward zero", () => {
    assert.equal(takeRight("Hello", 2.5), "lo");
  });

  it("errors on a non-finite count", () => {
    assert.equal(takeRight("Hello", NaN), VALUE_ERROR);
    assert.equal(takeRight("Hello", Infinity), VALUE_ERROR);
  });

  it("returns an empty string from an empty text", () => {
    assert.equal(takeRight("", 3), "");
  });
});

describe("takeLeft — negative count is an error", () => {
  it("errors on a negative count instead of returning an empty string", () => {
    assert.equal(takeLeft("Hello", -1), VALUE_ERROR);
  });

  it("returns an empty string for a zero count", () => {
    assert.equal(takeLeft("Hello", 0), "");
  });

  it("returns the whole string when the count exceeds its length", () => {
    assert.equal(takeLeft("Hello", 10), "Hello");
  });

  it("returns the leftmost characters for a normal count", () => {
    assert.equal(takeLeft("Hello", 2), "He");
  });

  it("truncates a fractional count and errors on a non-finite one", () => {
    assert.equal(takeLeft("Hello", 2.9), "He");
    assert.equal(takeLeft("Hello", NaN), VALUE_ERROR);
  });
});

describe("toProperCase — word boundaries include punctuation", () => {
  it("capitalises after an apostrophe and a hyphen, not only spaces", () => {
    assert.equal(toProperCase("o'neil-jr"), "O'Neil-Jr");
  });

  it("capitalises the first letter of each space-separated word", () => {
    assert.equal(toProperCase("hello world"), "Hello World");
  });

  it("lowercases the remaining letters of an all-caps word", () => {
    assert.equal(toProperCase("HELLO"), "Hello");
  });

  it("treats a digit as a non-letter boundary", () => {
    assert.equal(toProperCase("abc2def"), "Abc2Def");
  });

  it("returns an empty string for empty input", () => {
    assert.equal(toProperCase(""), "");
  });

  // A decomposed accented letter is a base letter + a combining mark; the mark
  // must not read as a word boundary and capitalize the next letter (#2388).
  it("keeps a decomposed accented letter as one word", () => {
    assert.equal(toProperCase("e\u0301clair"), "E\u0301clair", "NFD: e + combining acute");
    assert.equal(toProperCase("\u00e9clair"), "\u00c9clair", "NFC composed form");
  });

  it("leaves leading punctuation in place and capitalises the first letter", () => {
    assert.equal(toProperCase("'hello"), "'Hello");
  });
});

describe("SpreadsheetEngine — text edge cases end to end", () => {
  it("evaluates SUBSTITUTE with empty old_text and bad instance", () => {
    assert.equal(evalFormula('SUBSTITUTE("abc","","-")'), "abc");
    assert.equal(evalFormula('SUBSTITUTE("aa","a","b",0)'), VALUE_ERROR_TEXT);
  });

  it("evaluates RIGHT / LEFT with a negative count as an error", () => {
    assert.equal(evalFormula('RIGHT("Hello",-1)'), VALUE_ERROR_TEXT);
    assert.equal(evalFormula('LEFT("Hello",-1)'), VALUE_ERROR_TEXT);
  });

  it("errors on a non-numeric count and truncates a fractional one", () => {
    assert.equal(evalFormula('LEFT("Hello","x")'), VALUE_ERROR_TEXT);
    assert.equal(evalFormula('RIGHT("Hello","x")'), VALUE_ERROR_TEXT);
    assert.equal(evalFormula('RIGHT("Hello",2.5)'), "lo");
  });

  it("evaluates PROPER across punctuation boundaries", () => {
    assert.equal(evalFormula('PROPER("o\'neil-jr")'), "O'Neil-Jr");
  });
});
