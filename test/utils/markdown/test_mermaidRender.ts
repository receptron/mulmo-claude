// Verifies the DOM adoption step of the mermaid render pipeline
// against real jsdom, since the previous XML-mode DOMParser choked on
// mermaid's `<foreignObject>`-nested HTML (issue #1916). Runs in
// node:test with jsdom so the SVG parse path is exercised without
// booting mermaid itself.
//
// Imports the real production `adoptSvg` from the host source so the
// assertion tracks whatever the runtime does — inline duplicates go
// stale (CodeRabbit review on #1917).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { adoptSvg } from "@mulmoclaude/markdown-utils/markdown/mermaidRender";

let dom: JSDOM;

// Sample mermaid output shape for a subgraph diagram with an HTML
// label — this is the exact structure that broke XML-mode parsing:
// `<foreignObject>` wraps a `<div xmlns="…">` with `<br>` (unclosed
// in XML) inside.
const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
  <g class="subgraph">
    <foreignObject width="80" height="20">
      <div xmlns="http://www.w3.org/1999/xhtml">line 1<br>line 2</div>
    </foreignObject>
  </g>
</svg>`;

before(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  // adoptSvg reads the ambient `document` + `DOMParser` — point them at
  // the jsdom window's globals so the production helper runs unmodified.
  const win = dom.window as unknown as { document: Document; DOMParser: typeof DOMParser };
  (globalThis as unknown as { document: Document }).document = win.document;
  (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = win.DOMParser;
});

describe("adoptSvg (HTML5 mode)", () => {
  it("returns the svg root for a mermaid-shaped output", () => {
    const svgEl = adoptSvg(SAMPLE_SVG);
    assert.ok(svgEl, "expected an SVGElement");
    assert.equal(svgEl.tagName.toLowerCase(), "svg");
  });

  it("preserves the foreignObject subtree with its br tag", () => {
    const svgEl = adoptSvg(SAMPLE_SVG);
    assert.ok(svgEl);
    const foreign = svgEl.querySelector("foreignObject");
    assert.ok(foreign, "foreignObject preserved");
    // `<br>` in the source (unclosed in XML) survives HTML5 parsing.
    // The classic XML-mode DOMParser would have returned a
    // <parsererror> root here.
    const brTag = foreign.querySelector("br");
    assert.ok(brTag, "br survived");
  });

  it("returns null for input without an svg root", () => {
    const notSvg = "<p>not an svg</p>";
    const svgEl = adoptSvg(notSvg);
    assert.equal(svgEl, null);
  });
});
