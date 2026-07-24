// Unit tests for the shared LLM-JSON extraction helpers (#2336) used
// by the memory classifier and the topic clusterer.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractFirstObject, skipStringBody, stripFenceAndWhitespace } from "../../../server/workspace/memory/llm-json.js";

describe("memory/llm-json — stripFenceAndWhitespace", () => {
  it("returns unfenced text trimmed", () => {
    assert.equal(stripFenceAndWhitespace('{"a":1}'), '{"a":1}');
    assert.equal(stripFenceAndWhitespace('\n  {"a":1}  \n'), '{"a":1}');
  });

  it("strips a ```json fence", () => {
    assert.equal(stripFenceAndWhitespace('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it("strips a bare ``` fence", () => {
    assert.equal(stripFenceAndWhitespace('```\n{"a":1}\n```'), '{"a":1}');
  });

  it("strips the opening fence even when the closing one is missing", () => {
    assert.equal(stripFenceAndWhitespace('```json\n{"a":1}'), '{"a":1}');
  });

  it("leaves the opening fence on a single-line fence — extractFirstObject still recovers the object", () => {
    // A one-line ```{...}``` has no newline to cut the info string at, so
    // only the trailing fence goes. Pinned because the caller's tolerance
    // depends on extraction, not on this returning clean JSON.
    const stripped = stripFenceAndWhitespace('```{"a":1}```');
    assert.equal(stripped, '```{"a":1}');
    assert.equal(extractFirstObject(stripped), '{"a":1}');
  });

  it("ignores a fence that is not at the start", () => {
    const raw = 'Here you go: ```json\n{"a":1}\n```';
    assert.equal(stripFenceAndWhitespace(raw), raw);
  });

  it("handles empty and whitespace-only input", () => {
    assert.equal(stripFenceAndWhitespace(""), "");
    assert.equal(stripFenceAndWhitespace("   \n\t "), "");
  });
});

describe("memory/llm-json — extractFirstObject", () => {
  it("returns a flat object as-is", () => {
    assert.equal(extractFirstObject('{"a":1}'), '{"a":1}');
  });

  it("balances nested objects", () => {
    assert.equal(extractFirstObject('{"a":{"b":{"c":2}}}'), '{"a":{"b":{"c":2}}}');
  });

  it("ignores braces inside string literals", () => {
    assert.equal(extractFirstObject('{"a":"}"}'), '{"a":"}"}');
    assert.equal(extractFirstObject('{"a":"{"}'), '{"a":"{"}');
    assert.equal(extractFirstObject('{"a":"{{{"}, trailing'), '{"a":"{{{"}');
  });

  it("does not let an escaped quote close a string literal", () => {
    const text = '{"a":"say \\"}\\" out loud"}';
    const extracted = extractFirstObject(text);
    assert.equal(extracted, text);
    assert.deepEqual(JSON.parse(extracted ?? ""), { a: 'say "}" out loud' });
  });

  it("returns null when a string literal is never closed", () => {
    assert.equal(extractFirstObject('{"a":"unterminated'), null);
  });

  it("returns null when the object is never closed", () => {
    assert.equal(extractFirstObject('{"a":1'), null);
    assert.equal(extractFirstObject('{"a":{"b":2}'), null);
  });

  it("returns null when there is no opening brace", () => {
    assert.equal(extractFirstObject("null"), null);
    assert.equal(extractFirstObject("[1,2]"), null);
    assert.equal(extractFirstObject(""), null);
  });

  it("recovers the object from surrounding prose", () => {
    assert.equal(extractFirstObject('Sure: {"a":1} — let me know'), '{"a":1}');
  });

  it("stops at the first complete object", () => {
    assert.equal(extractFirstObject('{"a":1}{"b":2}'), '{"a":1}');
  });
});

describe("memory/llm-json — skipStringBody", () => {
  it("returns the index just past the closing quote", () => {
    assert.equal(skipStringBody('"abc"', 1), 5);
  });

  it("treats a backslash as escaping the next character", () => {
    assert.equal(skipStringBody('"a\\"b"', 1), 6);
  });

  it("lets an escaped backslash be followed by a real closing quote", () => {
    assert.equal(skipStringBody('"a\\\\"', 1), 5);
  });

  it("returns the text length when the string is unterminated", () => {
    assert.equal(skipStringBody('"abc', 1), 4);
    assert.equal(skipStringBody('"a\\"', 1), 4);
  });

  it("handles empty input and a start index at the end", () => {
    assert.equal(skipStringBody("", 0), 0);
    assert.equal(skipStringBody('"', 1), 1);
  });

  it("clamps a start index past the end to the text length", () => {
    assert.equal(skipStringBody("abc", 4), 3);
  });
});
