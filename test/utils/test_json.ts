import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonObject,
  findBalancedBraceBlock,
  findFencedJsonBody,
} from "../../server/utils/json.js";

describe("findFencedJsonBody", () => {
  it("extracts the body of a fenced json block", () => {
    const raw = 'Some text\n```json\n{"a":1}\n```\nMore text';
    assert.equal(findFencedJsonBody(raw), '{"a":1}');
  });

  it("returns null when no fenced block exists", () => {
    assert.equal(findFencedJsonBody("no fence here"), null);
  });

  it("returns null when the closing fence is missing", () => {
    assert.equal(findFencedJsonBody("```json\n{}\n"), null);
  });
});

describe("findBalancedBraceBlock", () => {
  it("finds a simple object", () => {
    assert.equal(findBalancedBraceBlock('before {"a":1} after'), '{"a":1}');
  });

  it("handles nested braces", () => {
    const raw = '{"a":{"b":2}}';
    assert.equal(findBalancedBraceBlock(raw), raw);
  });

  it("ignores braces inside strings", () => {
    const raw = '{"a": "hello { world }"}';
    assert.equal(findBalancedBraceBlock(raw), raw);
  });

  it("returns null when no opening brace", () => {
    assert.equal(findBalancedBraceBlock("no braces"), null);
  });

  it("returns null when braces are unbalanced", () => {
    assert.equal(findBalancedBraceBlock("{unclosed"), null);
  });
});

describe("extractJsonObject", () => {
  it("extracts from a fenced block (preferred path)", () => {
    const raw = 'Here is the JSON:\n```json\n{"key":"val"}\n```\nDone.';
    assert.deepEqual(extractJsonObject(raw), { key: "val" });
  });

  it("falls back to balanced braces when no fence", () => {
    const raw = 'The answer is {"x": 42} end.';
    assert.deepEqual(extractJsonObject(raw), { x: 42 });
  });

  it("returns null for plain text with no JSON", () => {
    assert.equal(extractJsonObject("just text, no json"), null);
  });

  it("returns null for malformed JSON inside braces", () => {
    assert.equal(extractJsonObject("{not: valid json}"), null);
  });

  it("handles escaped quotes inside strings", () => {
    const raw = '{"msg": "he said \\"hi\\""}';
    const result = extractJsonObject(raw);
    assert.deepEqual(result, { msg: 'he said "hi"' });
  });
});
