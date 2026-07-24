// Tests for renderMarkdownToSafeHtml — the single marked → sanitize
// path behind the skill/manageSkills `v-html` bindings. Verifies the
// empty-input guard, that marked output is DOMPurify-sanitised, and that
// the optional marked options flow through (so other v-html surfaces can
// converge on this helper without changing behaviour).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// `dompurify` (imported transitively via sanitize.ts) reads `window` at
// module load, so wire JSDOM into globals BEFORE importing the helper.
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

const { renderMarkdownToSafeHtml } = await import("../../../src/utils/markdown/renderMarkdown");

describe("renderMarkdownToSafeHtml — empty guard", () => {
  it("returns an empty string for an empty string", () => {
    assert.equal(renderMarkdownToSafeHtml(""), "");
  });

  it("returns an empty string for undefined", () => {
    assert.equal(renderMarkdownToSafeHtml(undefined), "");
  });

  it("returns an empty string for null", () => {
    assert.equal(renderMarkdownToSafeHtml(null), "");
  });
});

describe("renderMarkdownToSafeHtml — rendering", () => {
  it("renders a heading", () => {
    assert.match(renderMarkdownToSafeHtml("# Title"), /<h1>Title<\/h1>/);
  });

  it("renders inline emphasis", () => {
    assert.match(renderMarkdownToSafeHtml("**bold**"), /<strong>bold<\/strong>/);
  });
});

describe("renderMarkdownToSafeHtml — sanitisation", () => {
  it("strips a script tag from embedded HTML", () => {
    const output = renderMarkdownToSafeHtml("hello\n\n<script>alert(1)</script>");
    assert.doesNotMatch(output, /<script/);
    assert.match(output, /hello/);
  });

  it("strips an iframe pointing at a foreign host", () => {
    const output = renderMarkdownToSafeHtml('<iframe src="https://evil.example.com/x"></iframe>');
    assert.doesNotMatch(output, /<iframe/);
    assert.doesNotMatch(output, /evil\.example\.com/);
  });
});

describe("renderMarkdownToSafeHtml — options passthrough", () => {
  it("honours { breaks: true } by emitting <br> for a single newline", () => {
    assert.match(renderMarkdownToSafeHtml("a\nb", { breaks: true }), /<br\s*\/?>/);
  });

  it("does not emit <br> for a single newline by default", () => {
    assert.doesNotMatch(renderMarkdownToSafeHtml("a\nb"), /<br/);
  });
});
