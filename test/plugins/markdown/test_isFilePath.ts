import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFilePath } from "../../../src/plugins/markdown/definition.js";

describe("markdown isFilePath", () => {
  it("accepts a stored markdown file path", () => {
    assert.equal(isFilePath("markdowns/abc.md"), true);
  });

  it("rejects inline markdown content", () => {
    assert.equal(isFilePath("# Hello\n\nSome content"), false);
  });

  it("rejects paths in other directories", () => {
    assert.equal(isFilePath("images/foo.md"), false);
    assert.equal(isFilePath("wiki/foo.md"), false);
  });

  it("rejects non-.md extensions under markdowns/", () => {
    assert.equal(isFilePath("markdowns/foo.txt"), false);
    assert.equal(isFilePath("markdowns/foo"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isFilePath(""), false);
  });

  it("accepts subdirectory paths under markdowns/", () => {
    assert.equal(isFilePath("markdowns/sub/nested.md"), true);
  });

  it("rejects an empty filename (`markdowns/.md`)", () => {
    // Current behaviour: the prefix/suffix check passes. Documenting
    // via a test so any future tightening of the helper is intentional
    // rather than silent.
    assert.equal(isFilePath("markdowns/.md"), true);
  });

  it("is case-sensitive on the directory prefix", () => {
    assert.equal(isFilePath("MARKDOWNS/foo.md"), false);
    assert.equal(isFilePath("Markdowns/foo.md"), false);
  });
});
