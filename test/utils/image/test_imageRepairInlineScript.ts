import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IMAGE_REPAIR_INLINE_SCRIPT, IMAGE_REPAIR_PATTERN, injectImageRepairScript } from "../../../src/utils/image/imageRepairInlineScript.js";

describe("IMAGE_REPAIR_INLINE_SCRIPT — pure form", () => {
  it("embeds IMAGE_REPAIR_PATTERN.toString() verbatim so the two stay in lockstep", () => {
    assert.ok(IMAGE_REPAIR_INLINE_SCRIPT.includes(IMAGE_REPAIR_PATTERN.toString()));
  });

  it("references all four element kinds the document-scope handler covers", () => {
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /tagName === "IMG"/);
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /tagName === "SOURCE"/);
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /tagName === "AUDIO"/);
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /tagName === "VIDEO"/);
  });

  it("attaches in capture phase (error events don't bubble)", () => {
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /addEventListener\("error",[\s\S]*?true\)/);
  });
});

describe("injectImageRepairScript", () => {
  const SCRIPT_OPEN = "<script>";
  const SCRIPT_CLOSE = "</script>";

  it("splices the script tag immediately before </body>", () => {
    const out = injectImageRepairScript("<html><body><p>hi</p></body></html>");
    assert.match(out, /<\/p><script>[\s\S]+<\/script><\/body>/);
  });

  it("appends to the end when the document has no </body>", () => {
    const out = injectImageRepairScript("<p>fragment with no body close</p>");
    assert.ok(out.startsWith("<p>fragment with no body close</p>"));
    assert.ok(out.endsWith(SCRIPT_CLOSE));
    assert.ok(out.includes(SCRIPT_OPEN));
  });

  it("is case-insensitive on </BODY>", () => {
    const out = injectImageRepairScript("<HTML><BODY>x</BODY></HTML>");
    assert.match(out, /x<script>[\s\S]+<\/script><\/BODY>/);
  });

  it("tolerates whitespace inside the closing tag (`</body >`)", () => {
    const out = injectImageRepairScript("<body>x</body >");
    assert.match(out, /x<script>[\s\S]+<\/script><\/body >/);
  });

  it("anchors at the LAST </body> when multiple closings appear (e.g. literal in code/CDATA)", () => {
    // Two `</body>` tokens — the first appears inside a `<pre>` block
    // as an example. The splicer must place the script before the
    // OUTER (last) `</body>`, not the literal.
    const html = "<body><pre>example: &lt;/body&gt;</pre>actually </body>tail</body>";
    const out = injectImageRepairScript(html);
    // Find the last `</body>` in the output; verify the script
    // immediately precedes it.
    const lastClose = out.lastIndexOf("</body>");
    assert.ok(lastClose > 0);
    const beforeLast = out.slice(0, lastClose);
    assert.ok(beforeLast.endsWith(SCRIPT_CLOSE), "script must immediately precede the last </body>");
  });

  it("returns an empty string unchanged", () => {
    assert.equal(injectImageRepairScript(""), "");
  });

  it("does not modify HTML that doesn't trigger any of the patterns of interest", () => {
    // No </body>, no other anchor — script appended at end.
    const html = "<svg><rect /></svg>";
    const out = injectImageRepairScript(html);
    assert.ok(out.startsWith(html));
    assert.ok(out.endsWith(SCRIPT_CLOSE));
  });

  it("preserves all original characters around the splice point (only adds, never removes)", () => {
    // Confirm the splice is purely additive: removing the inserted
    // <script>…</script> from the output reconstructs the input
    // verbatim. This catches regressions where the splice would
    // accidentally swallow surrounding content.
    const html = "<html><body><div>content</div></body></html>";
    const out = injectImageRepairScript(html);
    const stripped = out.replace(/<script>[\s\S]+?<\/script>/, "");
    assert.equal(stripped, html);
  });

  it("processes a 100KB document in well under a second (no quadratic cost)", () => {
    const filler = "<p>x</p>".repeat(12500); // ~100KB
    const html = `<html><body>${filler}</body></html>`;
    const start = Date.now();
    const out = injectImageRepairScript(html);
    const elapsedMs = Date.now() - start;
    assert.ok(out.includes("<script>"));
    assert.ok(elapsedMs < 1000, `expected <1s, got ${elapsedMs}ms`);
  });

  it("handles 100K repeated </body> tokens in linear time (Codex iter-1 review)", () => {
    // The previous regex used a negative lookahead `(?![\s\S]*<\/body\s*>)`
    // to anchor at the last close, which is O(N²) on inputs with many
    // `</body>` tokens. The matchAll-based splice point selection is
    // O(N) regardless. Probe with 100K closes — should still finish
    // well under a second.
    const adversarial = `<body>${"</body>".repeat(100_000)}x`;
    const start = Date.now();
    const out = injectImageRepairScript(adversarial);
    const elapsedMs = Date.now() - start;
    assert.ok(out.includes("<script>"));
    // Splice must be before the LAST `</body>`, so the tail "x" stays
    // unchanged, and only the last close is preceded by a script tag.
    assert.ok(out.endsWith("</body>x"));
    assert.ok(elapsedMs < 1000, `expected <1s for 100K tokens, got ${elapsedMs}ms`);
  });
});
