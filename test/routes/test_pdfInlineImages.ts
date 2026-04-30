// Coverage for inlineImages — the PDF-side helper that turns
// <img src="..."> references into base64 data URIs so Puppeteer can
// render them. The hardening from #384 added a workspace-root
// boundary check; this file pins the LLM-friendly leading-slash
// case (e.g. "/artifacts/images/2026/04/foo.png") on top of the
// original markdowns-relative case ("../images/foo.png").

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { inlineImages } from "../../server/api/routes/pdf.js";

let workspaceRoot: string;
let imagesDir: string;
let pngPath: string;

const PNG_BYTES = Buffer.from("89504E470D0A1A0A0000000D49484452", "hex"); // PNG header bytes

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "pdf-inline-")));
  imagesDir = path.join(workspaceRoot, "artifacts", "images", "2026", "04");
  mkdirSync(imagesDir, { recursive: true });
  // A real markdowns/ dir so "../images/..." resolves through it.
  mkdirSync(path.join(workspaceRoot, "artifacts", "markdowns"), { recursive: true });
  pngPath = path.join(imagesDir, "foo.png");
  writeFileSync(pngPath, PNG_BYTES);
});

describe("inlineImages — workspace-rooted leading-slash form", () => {
  it("inlines /artifacts/... paths (the LLM web-convention shape)", () => {
    const html = '<img src="/artifacts/images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot });
    assert.match(out, /^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+">$/);
  });

  it("inlines paths without leading slash (markdowns-relative shape)", () => {
    // markdowns/ references go up to artifacts/, then into images/.
    const html = '<img src="../images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot });
    assert.match(out, /^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+">$/);
  });

  it("leaves data: URIs untouched", () => {
    const html = '<img src="data:image/png;base64,AAAA">';
    const out = inlineImages(html, { workspaceRoot });
    assert.equal(out, html);
  });

  it("leaves http(s):// URLs untouched", () => {
    const html = '<img src="https://example.com/foo.png">';
    const out = inlineImages(html, { workspaceRoot });
    assert.equal(out, html);
  });

  it("rejects path traversal that escapes the workspace", () => {
    const html = '<img src="../../../../etc/passwd">';
    const out = inlineImages(html, { workspaceRoot });
    // Original tag preserved (not inlined). Browser will 404 — better
    // than leaking arbitrary host files into the rendered PDF.
    assert.equal(out, html);
  });

  it("rejects /etc/passwd-style host-absolute paths once leading slash is stripped", () => {
    // After stripping the leading slash, "etc/passwd" is treated as
    // workspace-relative. It doesn't exist under workspaceRoot, so
    // safe-resolve rejects it and the tag passes through unchanged.
    const html = '<img src="/etc/passwd">';
    const out = inlineImages(html, { workspaceRoot });
    assert.equal(out, html);
  });

  it("preserves attributes around src", () => {
    const html = '<img alt="cat" src="/artifacts/images/2026/04/foo.png" width="100">';
    const out = inlineImages(html, { workspaceRoot });
    assert.match(out, /^<img alt="cat" src="data:image\/png;base64,[^"]+" width="100">$/);
  });

  it("transforms multiple <img> tags in one pass", () => {
    const html = '<p><img src="/artifacts/images/2026/04/foo.png"><img src="../images/2026/04/foo.png"></p>';
    const out = inlineImages(html, { workspaceRoot });
    const matches = out.match(/data:image\/png;base64,/g) ?? [];
    assert.equal(matches.length, 2, "both tags should be rewritten");
  });
});

describe("inlineImages — sourceDir parameter (Stage F: Wiki PDF)", () => {
  it("resolves ../../../artifacts/... from data/wiki/pages/", () => {
    // Wiki page directory needs to exist for path.resolve to behave
    // normally — although resolve doesn't actually stat. Create it
    // anyway for realism.
    mkdirSync(path.join(workspaceRoot, "data", "wiki", "pages"), { recursive: true });
    const html = '<img src="../../../artifacts/images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot, sourceDir: "data/wiki/pages" });
    assert.match(out, /^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+">$/);
  });

  it("falls back to legacy markdowns/ when sourceDir is omitted", () => {
    const html = '<img src="../images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot });
    assert.match(out, /data:image\/png;base64/);
  });

  it("rejects an absolute sourceDir, falls back to legacy default", () => {
    // path.isAbsolute("/etc") returns true. The function should
    // defang and still try the markdowns/ fallback (which DOES
    // contain ../images/foo.png because of the test's mkdirSync).
    const html = '<img src="../images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot, sourceDir: "/etc" });
    assert.match(out, /data:image\/png;base64/);
  });

  it("rejects a sourceDir containing .. segments, falls back to default", () => {
    const html = '<img src="../images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot, sourceDir: "../escape/me" });
    assert.match(out, /data:image\/png;base64/);
  });
});

describe("inlineImages — quote-form coverage (Stage F)", () => {
  it("inlines a single-quoted src", () => {
    const html = "<img src='/artifacts/images/2026/04/foo.png'>";
    const out = inlineImages(html, { workspaceRoot });
    assert.match(out, /^<img src='data:image\/png;base64,[^']+'>$/);
  });

  it("inlines an unquoted src", () => {
    const html = "<img src=/artifacts/images/2026/04/foo.png>";
    const out = inlineImages(html, { workspaceRoot });
    // Output uses double quotes for the canonical form.
    assert.match(out, /^<img src="data:image\/png;base64,[^"]+">$/);
  });

  it("inlines a self-closing <img />", () => {
    const html = '<img src="/artifacts/images/2026/04/foo.png" />';
    const out = inlineImages(html, { workspaceRoot });
    assert.match(out, /^<img src="data:image\/png;base64,[^"]+" \/>$/);
  });

  it("does NOT match data-src= (lookbehind defends against false matches)", () => {
    const html = '<img data-src="/artifacts/images/2026/04/foo.png" alt="y">';
    const out = inlineImages(html, { workspaceRoot });
    assert.equal(out, html);
  });

  it('leaves a malformed <img src="... (no closing quote) untouched', () => {
    const html = '<img src="aaaaa.png alt=broken>';
    const out = inlineImages(html, { workspaceRoot });
    assert.equal(out, html);
  });

  it("processes 100KB of input in linear time (no ReDoS)", () => {
    const html = `<img ${"a".repeat(100_000)}`;
    const start = Date.now();
    const out = inlineImages(html, { workspaceRoot });
    const elapsedMs = Date.now() - start;
    assert.equal(out, html);
    assert.ok(elapsedMs < 1000, `expected <1s, got ${elapsedMs}ms`);
  });
});

describe("inlineImages — attribute-boundary correctness (Codex #1023 review)", () => {
  it("does not rewrite a src= substring inside another attribute's quoted value", () => {
    // Without attribute-iterator parsing, the alt-internal `src=oops`
    // would be rewritten, corrupting the surrounding alt attribute
    // and the tag itself. The attribute walker consumes the alt
    // value as a unit so the real `src=` is the only one rewritten.
    const html = '<img alt="x src=oops" src="/artifacts/images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot });
    assert.ok(out.includes('alt="x src=oops"'));
    assert.match(out, /src="data:image\/png;base64,[^"]+"/);
  });

  it("does not rewrite namespaced attrs like xml:src or xlink:src", () => {
    const html = '<img xml:src="ignored.png" xlink:src="ignored2.png" src="/artifacts/images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot });
    assert.ok(out.includes('xml:src="ignored.png"'));
    assert.ok(out.includes('xlink:src="ignored2.png"'));
    assert.match(out, /\bsrc="data:image\/png;base64,[^"]+"/);
  });

  it("preserves a tutorial-style alt that mentions src=", () => {
    const html = '<img alt="example: src=foo.png" src="/artifacts/images/2026/04/foo.png">';
    const out = inlineImages(html, { workspaceRoot });
    assert.ok(out.includes('alt="example: src=foo.png"'));
    assert.match(out, /\bsrc="data:image\/png;base64,/);
  });
});
