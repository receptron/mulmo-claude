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
    const out = inlineImages(html, workspaceRoot);
    assert.match(out, /^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+">$/);
  });

  it("inlines paths without leading slash (markdowns-relative shape)", () => {
    // markdowns/ references go up to artifacts/, then into images/.
    const html = '<img src="../images/2026/04/foo.png">';
    const out = inlineImages(html, workspaceRoot);
    assert.match(out, /^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+">$/);
  });

  it("leaves data: URIs untouched", () => {
    const html = '<img src="data:image/png;base64,AAAA">';
    const out = inlineImages(html, workspaceRoot);
    assert.equal(out, html);
  });

  it("leaves http(s):// URLs untouched", () => {
    const html = '<img src="https://example.com/foo.png">';
    const out = inlineImages(html, workspaceRoot);
    assert.equal(out, html);
  });

  it("rejects path traversal that escapes the workspace", () => {
    const html = '<img src="../../../../etc/passwd">';
    const out = inlineImages(html, workspaceRoot);
    // Original tag preserved (not inlined). Browser will 404 — better
    // than leaking arbitrary host files into the rendered PDF.
    assert.equal(out, html);
  });

  it("rejects /etc/passwd-style host-absolute paths once leading slash is stripped", () => {
    // After stripping the leading slash, "etc/passwd" is treated as
    // workspace-relative. It doesn't exist under workspaceRoot, so
    // safe-resolve rejects it and the tag passes through unchanged.
    const html = '<img src="/etc/passwd">';
    const out = inlineImages(html, workspaceRoot);
    assert.equal(out, html);
  });

  it("preserves attributes around src", () => {
    const html = '<img alt="cat" src="/artifacts/images/2026/04/foo.png" width="100">';
    const out = inlineImages(html, workspaceRoot);
    assert.match(out, /^<img alt="cat" src="data:image\/png;base64,[^"]+" width="100">$/);
  });

  it("transforms multiple <img> tags in one pass", () => {
    const html = '<p><img src="/artifacts/images/2026/04/foo.png"><img src="../images/2026/04/foo.png"></p>';
    const out = inlineImages(html, workspaceRoot);
    const matches = out.match(/data:image\/png;base64,/g) ?? [];
    assert.equal(matches.length, 2, "both tags should be rewritten");
  });
});
