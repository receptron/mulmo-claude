import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFilePath } from "../../../src/plugins/markdown/definition.js";

describe("markdown isFilePath", () => {
  it("accepts the canonical artifacts/documents/ path", () => {
    assert.equal(isFilePath("artifacts/documents/abc.md"), true);
  });

  it("rejects inline markdown content", () => {
    assert.equal(isFilePath("# Hello\n\nSome content"), false);
  });

  it("rejects paths in other directories", () => {
    assert.equal(isFilePath("images/foo.md"), false);
    assert.equal(isFilePath("wiki/foo.md"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isFilePath(""), false);
  });

  it("accepts nested paths under artifacts/documents/", () => {
    assert.equal(isFilePath("artifacts/documents/sub/deep.md"), true);
  });

  it("rejects artifacts/documents/ with non-.md extension", () => {
    assert.equal(isFilePath("artifacts/documents/foo.txt"), false);
    assert.equal(isFilePath("artifacts/documents/foo"), false);
  });

  it("rejects artifacts/ without documents/ subdirectory", () => {
    assert.equal(isFilePath("artifacts/foo.md"), false);
    assert.equal(isFilePath("artifacts/spreadsheets/foo.md"), false);
  });

  it("is case-sensitive on the directory prefix", () => {
    assert.equal(isFilePath("ARTIFACTS/documents/foo.md"), false);
  });

  // Legacy pre-#284 prefix (`markdowns/`). Support was removed in
  // #773 — the migration script rewrites old session JSONL to
  // canonical paths so the validator can be symmetric with the
  // server.
  it("rejects the legacy markdowns/ prefix", () => {
    assert.equal(isFilePath("markdowns/abc.md"), false);
    assert.equal(isFilePath("markdowns/sub/nested.md"), false);
  });
});
