// Smoke tests for the MIME utility functions exported by @mulmobridge/client.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mimeFromExtension, isImageMime, isPdfMime, isSupportedAttachmentMime, parseDataUrl, buildDataUrl } from "../src/index.ts";

describe("mimeFromExtension", () => {
  it("returns known MIME types for common extensions", () => {
    assert.equal(mimeFromExtension("jpg"), "image/jpeg");
    assert.equal(mimeFromExtension("png"), "image/png");
    assert.equal(mimeFromExtension("pdf"), "application/pdf");
    assert.equal(mimeFromExtension("mp4"), "video/mp4");
  });

  it("is case-insensitive", () => {
    assert.equal(mimeFromExtension("JPG"), "image/jpeg");
    assert.equal(mimeFromExtension("Png"), "image/png");
  });

  it("returns fallback for unknown extensions", () => {
    assert.equal(mimeFromExtension("xyz"), "application/octet-stream");
    assert.equal(mimeFromExtension("xyz", "text/plain"), "text/plain");
  });
});

describe("isImageMime / isPdfMime / isSupportedAttachmentMime", () => {
  it("classifies image types", () => {
    assert.equal(isImageMime("image/jpeg"), true);
    assert.equal(isImageMime("image/png"), true);
    assert.equal(isImageMime("application/pdf"), false);
  });

  it("classifies PDF", () => {
    assert.equal(isPdfMime("application/pdf"), true);
    assert.equal(isPdfMime("image/png"), false);
  });

  it("isSupportedAttachmentMime covers both", () => {
    assert.equal(isSupportedAttachmentMime("image/jpeg"), true);
    assert.equal(isSupportedAttachmentMime("application/pdf"), true);
    assert.equal(isSupportedAttachmentMime("video/mp4"), false);
  });
});

describe("parseDataUrl / buildDataUrl", () => {
  it("round-trips a data URL", () => {
    const url = buildDataUrl("image/png", "AAAA");
    assert.equal(url, "data:image/png;base64,AAAA");
    const parsed = parseDataUrl(url);
    assert.ok(parsed);
    assert.equal(parsed.mimeType, "image/png");
    assert.equal(parsed.data, "AAAA");
  });

  it("returns null for invalid input", () => {
    assert.equal(parseDataUrl("not-a-data-url"), null);
    assert.equal(parseDataUrl(""), null);
  });

  it("handles parameterised data URLs", () => {
    const parsed = parseDataUrl("data:image/png;charset=binary;base64,BBBB");
    assert.ok(parsed);
    assert.equal(parsed.mimeType, "image/png");
    assert.equal(parsed.data, "BBBB");
  });
});
