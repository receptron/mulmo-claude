import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { svgExportBaseName } from "../../../src/plugins/presentSVG/exportName.js";

describe("svgExportBaseName", () => {
  it("falls back to 'drawing' for null", () => {
    assert.equal(svgExportBaseName(null), "drawing");
  });

  it("falls back to 'drawing' for empty string", () => {
    assert.equal(svgExportBaseName(""), "drawing");
  });

  it("strips directories and the .svg extension", () => {
    assert.equal(svgExportBaseName("artifacts/svg/2026/07/foo-123.svg"), "foo-123");
  });

  it("strips .SVG case-insensitively", () => {
    assert.equal(svgExportBaseName("FOO.SVG"), "FOO");
  });

  it("falls back when the name is empty after stripping", () => {
    assert.equal(svgExportBaseName(".svg"), "drawing");
  });

  it("keeps inner dots", () => {
    assert.equal(svgExportBaseName("a.b.svg"), "a.b");
  });

  it("handles a slash-less path", () => {
    assert.equal(svgExportBaseName("foo.svg"), "foo");
  });

  it("falls back for a trailing-slash path", () => {
    assert.equal(svgExportBaseName("artifacts/svg/"), "drawing");
  });

  // Only .svg is stripped by design — any other extension is part of the base name.
  it("keeps a non-svg extension", () => {
    assert.equal(svgExportBaseName("foo.png"), "foo.png");
  });
});
