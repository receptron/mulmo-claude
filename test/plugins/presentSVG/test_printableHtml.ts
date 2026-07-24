import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrintableHtml } from "../../../src/plugins/presentSVG/printableHtml.js";

describe("buildPrintableHtml", () => {
  it("embeds the URL in the img src", () => {
    const html = buildPrintableHtml("http://localhost/artifacts/svg/foo.svg");
    assert.ok(html.includes('<img src="http://localhost/artifacts/svg/foo.svg"'));
  });

  it("escapes double quotes so the URL cannot break out of the attribute", () => {
    const html = buildPrintableHtml('http://x/a".svg" onerror="alert(1)');
    assert.ok(!html.includes('".svg"'));
    assert.ok(html.includes("&quot;.svg&quot;"));
  });

  it("auto-prints once the image has rendered", () => {
    assert.ok(buildPrintableHtml("http://x/a.svg").includes('onload="window.print()"'));
  });

  it("keeps the print color-adjust and page-margin rules", () => {
    const html = buildPrintableHtml("http://x/a.svg");
    assert.ok(html.includes("print-color-adjust: exact"));
    assert.ok(html.includes("@page { margin: 10mm; }"));
  });

  it("yields well-formed HTML for an empty URL", () => {
    const html = buildPrintableHtml("");
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes('<img src=""'));
  });
});
