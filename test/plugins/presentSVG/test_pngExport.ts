import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseViewBoxAspect, pngCanvasSize, PNG_FALLBACK_DIM, PNG_SCALE } from "../../../src/plugins/presentSVG/pngExport.js";

describe("parseViewBoxAspect", () => {
  it("parses a plain viewBox", () => {
    assert.equal(parseViewBoxAspect('<svg viewBox="0 0 2000 500">'), 4);
  });

  it("parses comma-separated values and single quotes", () => {
    assert.equal(parseViewBoxAspect("<svg viewBox='0,0,300,150'>"), 2);
  });

  it("parses negative origins and decimal sizes", () => {
    assert.equal(parseViewBoxAspect('<svg viewBox="-10 -10 100.5 201">'), 100.5 / 201);
  });

  it("returns null when there is no viewBox", () => {
    assert.equal(parseViewBoxAspect('<svg width="10">'), null);
    assert.equal(parseViewBoxAspect(""), null);
  });

  it("returns null for zero or negative dimensions", () => {
    assert.equal(parseViewBoxAspect('<svg viewBox="0 0 0 100">'), null);
    assert.equal(parseViewBoxAspect('<svg viewBox="0 0 100 -5">'), null);
  });

  it("returns null for malformed numbers", () => {
    assert.equal(parseViewBoxAspect('<svg viewBox="0 0 abc 100">'), null);
  });
});

describe("pngCanvasSize", () => {
  it("doubles intrinsic dimensions", () => {
    assert.deepEqual(pngCanvasSize(400, 300, null), { width: 800, height: 600 });
  });

  it("ignores the aspect when both dimensions are known", () => {
    assert.deepEqual(pngCanvasSize(400, 300, 10), { width: 800, height: 600 });
  });

  // Regression: a viewBox-only SVG (Firefox reports 0×0) must keep its
  // aspect ratio instead of being squashed into the square fallback.
  it("preserves a wide viewBox aspect when both dimensions are 0", () => {
    assert.deepEqual(pngCanvasSize(0, 0, 4), {
      width: PNG_FALLBACK_DIM * PNG_SCALE,
      height: (PNG_FALLBACK_DIM / 4) * PNG_SCALE,
    });
  });

  it("preserves a tall viewBox aspect when both dimensions are 0", () => {
    assert.deepEqual(pngCanvasSize(0, 0, 0.5), {
      width: PNG_FALLBACK_DIM * 0.5 * PNG_SCALE,
      height: PNG_FALLBACK_DIM * PNG_SCALE,
    });
  });

  it("falls back to a square when nothing is known", () => {
    assert.deepEqual(pngCanvasSize(0, 0, null), {
      width: PNG_FALLBACK_DIM * PNG_SCALE,
      height: PNG_FALLBACK_DIM * PNG_SCALE,
    });
  });

  it("derives a missing height from the aspect", () => {
    assert.deepEqual(pngCanvasSize(400, 0, 4), { width: 800, height: 200 });
  });

  it("derives a missing width from the aspect", () => {
    assert.deepEqual(pngCanvasSize(0, 300, 2), { width: 1200, height: 600 });
  });

  it("uses the square fallback for a missing dimension without aspect", () => {
    assert.deepEqual(pngCanvasSize(400, 0, null), { width: 800, height: PNG_FALLBACK_DIM * PNG_SCALE });
  });

  it("never returns a zero dimension for extreme aspects", () => {
    const { height } = pngCanvasSize(0, 0, 1e9);
    assert.ok(height >= PNG_SCALE);
    const { width } = pngCanvasSize(0, 0, 1e-9);
    assert.ok(width >= PNG_SCALE);
  });

  it("treats a non-finite or non-positive aspect as unknown", () => {
    assert.deepEqual(pngCanvasSize(0, 0, Number.NaN), pngCanvasSize(0, 0, null));
    assert.deepEqual(pngCanvasSize(0, 0, -2), pngCanvasSize(0, 0, null));
    assert.deepEqual(pngCanvasSize(0, 0, 0), pngCanvasSize(0, 0, null));
  });
});
