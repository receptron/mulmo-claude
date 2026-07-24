import { test } from "node:test";
import assert from "node:assert/strict";

import { escapeHtml } from "../src/index.ts";

// The copies folded into this helper (#2483) were written in two spellings:
// the switch-map that `@mulmoclaude/core/wiki` used, and the chained
// `.replace` / `.replaceAll` that spotify-plugin, markdown-utils and the host
// runtime-plugin route used. Both are reproduced here so the fold is pinned as
// output-identical rather than assumed to be.
const switchMapSpelling = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const chainedReplaceSpelling = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const SAMPLES = [
  "",
  "plain text",
  "<script>alert('x')</script>",
  `a & b < c > d " e ' f`,
  "&amp;",
  "&&&",
  "&lt;already escaped&gt;",
  "日本語 & <タグ>",
  '"quoted"',
  "'single'",
  "a\nb\t<c>",
  "🎵 & 🎶",
];

test("escapeHtml: maps exactly the five HTML-significant characters", () => {
  assert.equal(escapeHtml(`& < > " '`), "&amp; &lt; &gt; &quot; &#39;");
});

test("escapeHtml: leaves text without significant characters untouched", () => {
  assert.equal(escapeHtml("plain text 123 日本語 🎵"), "plain text 123 日本語 🎵");
});

test("escapeHtml: empty string", () => {
  assert.equal(escapeHtml(""), "");
});

test("escapeHtml: escapes ampersand once, never double-escaping its own output", () => {
  // `&` is replaced first and the entities it introduces contain none of the
  // other four characters, so a single pass is safe.
  assert.equal(escapeHtml("&amp;"), "&amp;amp;");
  assert.equal(escapeHtml("&&&"), "&amp;&amp;&amp;");
});

test("escapeHtml: neutralises a script tag", () => {
  assert.equal(escapeHtml("<script>alert('x')</script>"), "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
});

test("escapeHtml: agrees with the switch-map spelling it replaced", () => {
  SAMPLES.forEach((sample) => assert.equal(escapeHtml(sample), switchMapSpelling(sample), `mismatch for ${JSON.stringify(sample)}`));
});

test("escapeHtml: agrees with the chained-replace spelling it replaced", () => {
  SAMPLES.forEach((sample) => assert.equal(escapeHtml(sample), chainedReplaceSpelling(sample), `mismatch for ${JSON.stringify(sample)}`));
});
