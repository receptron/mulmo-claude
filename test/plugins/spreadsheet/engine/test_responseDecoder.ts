import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeSpreadsheetResponse } from "../../../../src/plugins/spreadsheet/engine/responseDecoder.js";

describe("decodeSpreadsheetResponse", () => {
  it("ok when kind is text with valid JSON array content", () => {
    const sheets = [{ name: "Sheet1", data: [] }];
    const result = decodeSpreadsheetResponse({
      kind: "text",
      content: JSON.stringify(sheets),
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.sheets, sheets);
  });

  it("ok when kind is missing (legacy response)", () => {
    const sheets = [{ name: "A", data: [[{ v: 1 }]] }];
    const result = decodeSpreadsheetResponse({
      content: JSON.stringify(sheets),
    });
    assert.equal(result.kind, "ok");
  });

  it("error when kind is too-large", () => {
    const result = decodeSpreadsheetResponse({
      kind: "too-large",
      message: "File exceeds size limit",
    });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.message, "File exceeds size limit");
  });

  it("error when kind is binary", () => {
    const result = decodeSpreadsheetResponse({ kind: "binary" });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.match(result.message, /binary/);
  });

  it("error when content is missing", () => {
    const result = decodeSpreadsheetResponse({ kind: "text" });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.match(result.message, /no content/i);
  });

  it("error when content is not a string", () => {
    // unsafely cast to exercise the runtime branch
    const result = decodeSpreadsheetResponse({
      kind: "text",
      content: 123 as unknown as string,
    });
    assert.equal(result.kind, "error");
  });

  it("error when JSON is malformed", () => {
    const result = decodeSpreadsheetResponse({
      kind: "text",
      content: "{not valid json",
    });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.match(result.message, /malformed/i);
  });

  it("error when content is valid JSON but not an array", () => {
    const result = decodeSpreadsheetResponse({
      kind: "text",
      content: '{"name": "Sheet1"}',
    });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.match(result.message, /not an array/i);
  });

  it("empty array is ok (new spreadsheet)", () => {
    const result = decodeSpreadsheetResponse({
      kind: "text",
      content: "[]",
    });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.sheets, []);
  });
});
