import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripDataUri, isImagePath } from "../../server/utils/files/image-store.js";

describe("stripDataUri", () => {
  it("strips a standard PNG data URI prefix", () => {
    assert.equal(stripDataUri("data:image/png;base64,abc123"), "abc123");
  });

  it("strips a JPEG data URI prefix", () => {
    assert.equal(stripDataUri("data:image/jpeg;base64,xyz"), "xyz");
  });

  it("strips a WebP data URI prefix", () => {
    assert.equal(stripDataUri("data:image/webp;base64,foo"), "foo");
  });

  it("returns the string unchanged when no data URI prefix is present", () => {
    assert.equal(stripDataUri("abc123"), "abc123");
  });

  it("returns empty string when input is just the prefix", () => {
    assert.equal(stripDataUri("data:image/png;base64,"), "");
  });

  it("handles empty string input", () => {
    assert.equal(stripDataUri(""), "");
  });

  it("preserves base64 content with special characters", () => {
    const b64 = "aGVsbG8gd29ybGQ=+/==";
    assert.equal(stripDataUri(`data:image/png;base64,${b64}`), b64);
  });
});

describe("isImagePath", () => {
  it("accepts a canonical image path", () => {
    assert.equal(isImagePath("artifacts/images/abc123.png"), true);
  });

  it("accepts a UUID-like filename", () => {
    assert.equal(isImagePath("artifacts/images/a1b2c3d4e5f67890.png"), true);
  });

  it("rejects non-image directory prefixes", () => {
    assert.equal(isImagePath("artifacts/charts/foo.png"), false);
    assert.equal(isImagePath("images/foo.png"), false); // pre-#284 layout
    assert.equal(isImagePath("foo.png"), false);
  });

  it("rejects non-png extensions", () => {
    assert.equal(isImagePath("artifacts/images/foo.jpg"), false);
    assert.equal(isImagePath("artifacts/images/foo.json"), false);
    assert.equal(isImagePath("artifacts/images/foo.md"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isImagePath(""), false);
  });

  it("rejects path with only the prefix", () => {
    assert.equal(isImagePath("artifacts/images/"), false);
  });

  it("rejects path with traversal segments", () => {
    // isImagePath only checks prefix + suffix; traversal is caught by safeResolve.
    // But the path must still start with the prefix and end with .png.
    assert.equal(isImagePath("artifacts/images/../etc/passwd"), false);
  });

  it("rejects a path that ends with .png but has wrong prefix", () => {
    assert.equal(isImagePath("other/dir/file.png"), false);
  });
});
