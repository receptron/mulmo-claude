// The body gates for the file-content write route. Both decide whether bytes
// reach disk, and both were untested — only reachable through the HTTP route,
// which meant the edge cases (an empty file, a `.JSON` uppercase extension, a
// path that is a number) were never exercised at all.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jsonSyntaxError, MAX_PREVIEW_BYTES, validatePutContentRequest } from "../../../server/utils/files/content-write-validate.js";

describe("validatePutContentRequest", () => {
  it("accepts a well-formed body and reports its byte length", () => {
    const result = validatePutContentRequest({ path: "notes.md", content: "hello" });
    assert.deepEqual(result, { ok: true, relPath: "notes.md", content: "hello", bytes: 5 });
  });

  // Emptying a file is a legitimate edit, so zero bytes must pass.
  it("accepts empty content", () => {
    const result = validatePutContentRequest({ path: "notes.md", content: "" });
    assert.deepEqual(result, { ok: true, relPath: "notes.md", content: "", bytes: 0 });
  });

  // The cap is on BYTES, not characters — a multi-byte string is bigger than
  // its length suggests, and the downstream write budgets against bytes.
  it("measures multi-byte content in utf-8 bytes, not characters", () => {
    const result = validatePutContentRequest({ path: "notes.md", content: "日本語" });
    assert.equal(result.ok && result.bytes, 9);
  });

  it("rejects a missing or empty path", () => {
    for (const body of [{ content: "x" }, { path: "", content: "x" }, { path: 7, content: "x" }, { path: null, content: "x" }]) {
      const result = validatePutContentRequest(body);
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.message, "path required");
    }
  });

  // The missing-path branch deliberately omits `logExtra`: passing `{}` would
  // make the logger emit an empty `data` field.
  it("omits logExtra on the missing-path branch", () => {
    const result = validatePutContentRequest({});
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && "logExtra" in result, false);
  });

  it("rejects non-string content, including null and a number", () => {
    for (const content of [undefined, null, 7, {}, ["x"]]) {
      const result = validatePutContentRequest({ path: "notes.md", content });
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.message, "content required");
    }
  });

  it("carries a path preview in logExtra once the path is known", () => {
    const result = validatePutContentRequest({ path: "notes.md" });
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok === false && result.logExtra, { pathPreview: "notes.md" });
  });

  it("accepts content exactly at the cap and rejects one byte over", () => {
    const atCap = validatePutContentRequest({ path: "big.txt", content: "a".repeat(MAX_PREVIEW_BYTES) });
    assert.equal(atCap.ok, true);
    const overCap = validatePutContentRequest({ path: "big.txt", content: "a".repeat(MAX_PREVIEW_BYTES + 1) });
    assert.equal(overCap.ok, false);
    assert.equal(overCap.ok === false && overCap.message, `content exceeds ${MAX_PREVIEW_BYTES} byte limit`);
  });

  it("survives a null, undefined or primitive body instead of throwing", () => {
    for (const body of [null, undefined, "path=x", 7]) {
      assert.equal(validatePutContentRequest(body).ok, false);
    }
  });

  // Inherited fields must not satisfy the gate: a polluted `Object.prototype`
  // would otherwise supply a `path` the caller never sent. A real
  // `express.json()` body carries only own properties, so requiring them
  // rejects nothing legitimate.
  it("does not read path or content off the prototype chain", () => {
    const body = Object.create({ path: "evil.txt", content: "pwned" }) as unknown;
    assert.equal(validatePutContentRequest(body).ok, false);
  });

  // `JSON.parse` gives `__proto__` as an OWN data property rather than setting
  // the prototype, so this body has no `path` at all. Kept as its own case
  // because it looks like the prototype-chain test and is not one — the check
  // above is what covers inheritance.
  it("treats a JSON-parsed __proto__ key as an ordinary absent path", () => {
    const body = JSON.parse('{"__proto__": {"path": "evil.txt", "content": "x"}}') as unknown;
    const result = validatePutContentRequest(body);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message, "path required");
  });
});

describe("jsonSyntaxError", () => {
  it("passes non-json paths through without parsing", () => {
    assert.equal(jsonSyntaxError("notes.md", "{ not json"), null);
    assert.equal(jsonSyntaxError("script.ts", "}{"), null);
  });

  it("accepts valid json", () => {
    assert.equal(jsonSyntaxError("schema.json", '{"a":1}'), null);
    assert.equal(jsonSyntaxError("list.json", "[]"), null);
    assert.equal(jsonSyntaxError("bare.json", "null"), null);
  });

  it("reports invalid json with a reason", () => {
    const error = jsonSyntaxError("schema.json", "{ not json");
    assert.ok(error?.startsWith("Invalid JSON: "), `expected a reason, got: ${String(error)}`);
  });

  // An empty file is not valid JSON, and saving one would break the next load.
  it("rejects empty content for a json path", () => {
    assert.ok(jsonSyntaxError("schema.json", ""));
  });

  // Case-insensitive: the filesystem on macOS and Windows is, so a `.JSON`
  // file is the same file and needs the same gate.
  it("matches the .json extension case-insensitively", () => {
    assert.ok(jsonSyntaxError("SCHEMA.JSON", "{ not json"));
    assert.ok(jsonSyntaxError("Schema.Json", "{ not json"));
  });

  // Only the extension counts — a path that merely mentions json elsewhere is
  // not a json file.
  it("does not match a path that only contains 'json' elsewhere", () => {
    assert.equal(jsonSyntaxError("json/notes.md", "{ not json"), null);
    assert.equal(jsonSyntaxError("schema.json.bak", "{ not json"), null);
  });
});
