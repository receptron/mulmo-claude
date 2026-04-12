import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSpreadsheetPath } from "../../server/utils/spreadsheet-store.js";

describe("isSpreadsheetPath", () => {
  it("accepts a canonical path", () => {
    assert.equal(isSpreadsheetPath("spreadsheets/abc123.json"), true);
  });

  it("accepts a UUID-like filename", () => {
    assert.equal(isSpreadsheetPath("spreadsheets/a1b2c3d4e5f6g7h8.json"), true);
  });

  it("rejects non-spreadsheet prefixes", () => {
    assert.equal(isSpreadsheetPath("images/foo.json"), false);
    assert.equal(isSpreadsheetPath("foo.json"), false);
  });

  it("rejects non-json suffixes", () => {
    assert.equal(isSpreadsheetPath("spreadsheets/foo.txt"), false);
    assert.equal(isSpreadsheetPath("spreadsheets/foo"), false);
  });

  it("rejects path traversal attempts (regression)", () => {
    assert.equal(isSpreadsheetPath("spreadsheets/../outside.json"), false);
    assert.equal(
      isSpreadsheetPath("spreadsheets/../../etc/passwd.json"),
      false,
    );
    assert.equal(isSpreadsheetPath("spreadsheets/./local.json"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isSpreadsheetPath(""), false);
  });
});
