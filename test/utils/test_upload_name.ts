// Filename rules for dropped-file uploads (#2270). These decide whether a
// client-supplied name can escape its target folder, so the traversal cases
// matter as much as the happy path.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renamedCandidate, sanitizeUploadFilename } from "../../server/utils/files/upload-name.js";

/** A control character, written as an escape so it stays visible in review. */
const BELL = String.fromCharCode(7);

describe("sanitizeUploadFilename", () => {
  it("keeps an ordinary filename unchanged", () => {
    assert.equal(sanitizeUploadFilename("photo.png"), "photo.png");
  });

  it("reduces a POSIX traversal to its last segment", () => {
    assert.equal(sanitizeUploadFilename("../../etc/passwd"), "passwd");
  });

  it("reduces a Windows path to its last segment (host separator is irrelevant)", () => {
    assert.equal(sanitizeUploadFilename("C:\\Windows\\system32\\evil.dll"), "evil.dll");
  });

  it("strips control characters", () => {
    assert.equal(sanitizeUploadFilename(`repo${BELL}rt.pdf`), "report.pdf");
  });

  it("returns null for an empty name", () => {
    assert.equal(sanitizeUploadFilename(""), null);
  });

  it("returns null for whitespace only", () => {
    assert.equal(sanitizeUploadFilename("   "), null);
  });

  it("returns null for `.`", () => {
    assert.equal(sanitizeUploadFilename("."), null);
  });

  it("returns null for `..`", () => {
    assert.equal(sanitizeUploadFilename(".."), null);
  });

  it("returns null when a path has no final segment", () => {
    assert.equal(sanitizeUploadFilename("foo/bar/"), null);
  });

  it("truncates an over-long name but keeps the extension", () => {
    const result = sanitizeUploadFilename(`${"a".repeat(400)}.png`);
    assert.ok(result !== null);
    assert.ok(result.endsWith(".png"), `expected .png suffix, got ${result}`);
    assert.ok(result.length <= 200, `expected <= 200 chars, got ${result.length}`);
  });

  it("preserves a dotfile name", () => {
    assert.equal(sanitizeUploadFilename(".gitignore"), ".gitignore");
  });

  // Windows drops trailing dots/spaces when it creates the file, so a name
  // ending in one would reach disk as the stripped form while `extname` saw
  // something harmless — an extension-blocklist bypass.
  it("strips a trailing dot so the real extension is visible to policy", () => {
    assert.equal(sanitizeUploadFilename("malware.exe."), "malware.exe");
  });

  it("strips several trailing dots", () => {
    assert.equal(sanitizeUploadFilename("malware.exe..."), "malware.exe");
  });

  it("strips trailing spaces", () => {
    assert.equal(sanitizeUploadFilename("report.pdf  "), "report.pdf");
  });

  it("still rejects a name that is only dots", () => {
    assert.equal(sanitizeUploadFilename("..."), null);
  });
});

describe("renamedCandidate", () => {
  it("inserts the attempt before the extension", () => {
    assert.equal(renamedCandidate("foo.png", 1), "foo (1).png");
  });

  it("appends when there is no extension", () => {
    assert.equal(renamedCandidate("README", 2), "README (2)");
  });

  it("treats a dotfile as having no extension", () => {
    assert.equal(renamedCandidate(".env", 1), ".env (1)");
  });

  it("only splits on the last extension", () => {
    assert.equal(renamedCandidate("archive.tar.gz", 3), "archive.tar (3).gz");
  });
});
