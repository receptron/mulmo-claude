import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCrossOriginHttpUrl } from "../../../src/utils/dom/externalLink.js";

const ORIGIN = "http://localhost:3001";

describe("isCrossOriginHttpUrl", () => {
  it("returns true for an http URL with a different origin", () => {
    assert.equal(isCrossOriginHttpUrl("http://example.com/page", ORIGIN), true);
  });

  it("returns true for an https URL with a different origin", () => {
    assert.equal(isCrossOriginHttpUrl("https://example.com/page", ORIGIN), true);
  });

  it("returns true for a different port on the same host", () => {
    // Different port → different origin per the web platform's
    // same-origin policy.
    assert.equal(isCrossOriginHttpUrl("http://localhost:8080/foo", ORIGIN), true);
  });

  it("returns false for a same-origin http URL", () => {
    assert.equal(isCrossOriginHttpUrl("http://localhost:3001/files/foo", ORIGIN), false);
  });

  it("returns false for a same-origin hash anchor (after href resolution)", () => {
    // `anchor.href` in the browser resolves `#section` to a full
    // URL like "http://localhost:3001/#section", which is
    // same-origin, so it should NOT be opened in a new tab — let
    // the browser scroll to the fragment instead.
    assert.equal(isCrossOriginHttpUrl("http://localhost:3001/#section", ORIGIN), false);
  });

  it("returns false for mailto: links", () => {
    assert.equal(isCrossOriginHttpUrl("mailto:alice@example.com", ORIGIN), false);
  });

  it("returns false for tel: links", () => {
    assert.equal(isCrossOriginHttpUrl("tel:+81-90-1234-5678", ORIGIN), false);
  });

  it("returns false for javascript: links (defensive)", () => {
    // eslint-disable-next-line no-script-url -- guard test fixture
    assert.equal(isCrossOriginHttpUrl("javascript:void(0)", ORIGIN), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(isCrossOriginHttpUrl("", ORIGIN), false);
  });

  it("returns false for a malformed URL that can't be parsed", () => {
    // "http://" alone is not a valid URL for the URL constructor.
    assert.equal(isCrossOriginHttpUrl("http://", ORIGIN), false);
  });

  it("returns false for a URL with no scheme (already relative)", () => {
    // Relative paths never reach this function from the click
    // handler (because `anchor.href` resolves them to an absolute
    // URL first), but the predicate should still reject them if
    // called directly.
    assert.equal(isCrossOriginHttpUrl("/files/foo.md", ORIGIN), false);
  });

  it("handles https origin correctly", () => {
    const httpsOrigin = "https://app.mulmoclaude.test";
    assert.equal(isCrossOriginHttpUrl("https://app.mulmoclaude.test/page", httpsOrigin), false);
    assert.equal(isCrossOriginHttpUrl("https://external.example.com/page", httpsOrigin), true);
  });

  it("treats http vs https on the same host as cross-origin", () => {
    // Scheme is part of the origin in the web platform.
    assert.equal(isCrossOriginHttpUrl("https://localhost:3001/foo", "http://localhost:3001"), true);
  });
});
