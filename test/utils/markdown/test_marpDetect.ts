import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMarpDocument } from "@mulmoclaude/markdown-utils/markdown/marpDetect";

describe("isMarpDocument", () => {
  it("returns true for boolean true", () => {
    assert.equal(isMarpDocument({ marp: true }), true);
  });

  it("returns true for the numeric 1 (YAML truthiness corner)", () => {
    assert.equal(isMarpDocument({ marp: 1 }), true);
  });

  it("accepts the string forms 'true' / 'yes' / '1', case-insensitive, with surrounding whitespace", () => {
    assert.equal(isMarpDocument({ marp: "true" }), true);
    assert.equal(isMarpDocument({ marp: "TRUE" }), true);
    assert.equal(isMarpDocument({ marp: "yes" }), true);
    assert.equal(isMarpDocument({ marp: "Yes" }), true);
    assert.equal(isMarpDocument({ marp: "1" }), true);
    assert.equal(isMarpDocument({ marp: "  true  " }), true);
  });

  it("returns false when the key is absent", () => {
    assert.equal(isMarpDocument({}), false);
    assert.equal(isMarpDocument({ title: "Hello" }), false);
  });

  it("returns false for boolean false", () => {
    assert.equal(isMarpDocument({ marp: false }), false);
  });

  it("returns false for string 'false' / 'no' / '0' / empty", () => {
    assert.equal(isMarpDocument({ marp: "false" }), false);
    assert.equal(isMarpDocument({ marp: "no" }), false);
    assert.equal(isMarpDocument({ marp: "0" }), false);
    assert.equal(isMarpDocument({ marp: "" }), false);
  });

  it("returns false for null / undefined", () => {
    assert.equal(isMarpDocument({ marp: null }), false);
    assert.equal(isMarpDocument({ marp: undefined }), false);
  });

  it("returns false for non-boolean / non-string objects or arrays", () => {
    assert.equal(isMarpDocument({ marp: { enabled: true } }), false);
    assert.equal(isMarpDocument({ marp: ["true"] }), false);
  });

  it("does not collide with neighbouring keys", () => {
    assert.equal(isMarpDocument({ marp: true, title: "x", tags: ["a"] }), true);
    assert.equal(isMarpDocument({ marpy: true }), false);
    assert.equal(isMarpDocument({ MARP: true }), false);
  });
});
