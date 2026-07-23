import { test } from "node:test";
import assert from "node:assert/strict";
import { fileWatchChannel, nextFileVersion } from "../../src/plugin-vue/fileWatch.ts";

test("fileWatchChannel builds the plugin-scoped file channel", () => {
  assert.equal(fileWatchChannel("artifacts/html/page.html"), "file:artifacts/html/page.html");
  assert.equal(fileWatchChannel(""), "file:");
});

test("nextFileVersion bumps to a strictly-greater mtimeMs (happy path)", () => {
  assert.equal(nextFileVersion(0, { mtimeMs: 1000 }), 1000);
  assert.equal(nextFileVersion(1000, { mtimeMs: 2000 }), 2000);
});

test("nextFileVersion collapses same-ms writes (equal mtime does not bump)", () => {
  assert.equal(nextFileVersion(1500, { mtimeMs: 1500 }), 1500);
});

test("nextFileVersion drops out-of-order events (smaller mtime is ignored)", () => {
  assert.equal(nextFileVersion(2000, { mtimeMs: 1000 }), 2000);
});

test("nextFileVersion ignores missing / non-number / undefined payloads", () => {
  assert.equal(nextFileVersion(5, undefined), 5);
  assert.equal(nextFileVersion(5, {}), 5);
  assert.equal(nextFileVersion(5, { mtimeMs: undefined }), 5);
  assert.equal(nextFileVersion(5, { mtimeMs: Number.NaN }), 5);
});

test("nextFileVersion ignores non-object payloads (untyped pubsub data)", () => {
  assert.equal(nextFileVersion(5, null), 5);
  assert.equal(nextFileVersion(5, "junk"), 5);
  assert.equal(nextFileVersion(5, 9000), 5);
  assert.equal(nextFileVersion(5, [9000]), 5);
});

test("nextFileVersion treats a negative-but-greater mtime as a bump (monotonic only)", () => {
  assert.equal(nextFileVersion(-10, { mtimeMs: -5 }), -5);
});
