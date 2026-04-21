import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, findBalancedBraceBlock } from "../../server/workspace/journal/archivist.js";

describe("findBalancedBraceBlock", () => {
  it("extracts a simple JSON object", () => {
    assert.equal(findBalancedBraceBlock('{"a":1}'), '{"a":1}');
  });

  it("extracts nested braces", () => {
    assert.equal(findBalancedBraceBlock('{"a":{"b":2}}'), '{"a":{"b":2}}');
  });

  it("ignores braces inside strings", () => {
    assert.equal(findBalancedBraceBlock('{"a":"}{"}'), '{"a":"}{"}');
  });

  it("handles escaped quotes inside strings", () => {
    assert.equal(findBalancedBraceBlock('{"a":"\\"}{"}'), '{"a":"\\"}{"}');
  });

  it("skips leading text before the first brace", () => {
    assert.equal(findBalancedBraceBlock('some text {"key":"val"}'), '{"key":"val"}');
  });

  it("returns null when no braces exist", () => {
    assert.equal(findBalancedBraceBlock("no json here"), null);
  });

  it("returns null for unbalanced braces", () => {
    assert.equal(findBalancedBraceBlock('{"a":1'), null);
  });

  it("returns null for empty string", () => {
    assert.equal(findBalancedBraceBlock(""), null);
  });
});

describe("extractJsonObject", () => {
  it("parses a fenced ```json block", () => {
    const raw = 'Here is the result:\n```json\n{"x":42}\n```\nDone.';
    assert.deepEqual(extractJsonObject(raw), { x: 42 });
  });

  it("falls back to balanced brace scan when fence is absent", () => {
    const raw = 'The output is: {"y":"hello"} and more text.';
    assert.deepEqual(extractJsonObject(raw), { y: "hello" });
  });

  it("falls back to scan when fenced block has invalid JSON", () => {
    // The scan finds the FIRST balanced brace block, which is {invalid}
    // inside the fence. Since that's also not valid JSON, null is returned.
    const raw = '```json\n{invalid}\n```\n{"valid":true}';
    assert.equal(extractJsonObject(raw), null);
  });

  it("falls back to scan when no fence exists but valid JSON is present", () => {
    const raw = 'some text {"valid":true} more text';
    assert.deepEqual(extractJsonObject(raw), { valid: true });
  });

  it("returns null when no JSON is present", () => {
    assert.equal(extractJsonObject("just plain text"), null);
  });

  it("returns null for invalid JSON in braces", () => {
    assert.equal(extractJsonObject("{not: valid json}"), null);
  });

  it("handles complex nested objects", () => {
    const obj = { a: { b: [1, 2, 3] }, c: "hello" };
    const raw = `prefix ${JSON.stringify(obj)} suffix`;
    assert.deepEqual(extractJsonObject(raw), obj);
  });
});
