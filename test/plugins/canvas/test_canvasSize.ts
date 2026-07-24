import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCanvasSize, CANVAS_PADDING_PX } from "../../../src/plugins/canvas/canvasSize.js";

const zero = { width: 0, height: 0 };

describe("computeCanvasSize", () => {
  it("derives a 16:9 size from the container width minus padding", () => {
    const { size } = computeCanvasSize(832 + CANVAS_PADDING_PX, zero);
    assert.deepEqual(size, { width: 832, height: 468 });
  });

  it("flags the first paint when the current width is 0", () => {
    const decision = computeCanvasSize(400, zero);
    assert.equal(decision.isFirstPaint, true);
    assert.equal(decision.changed, true);
  });

  it("does not flag first paint once a size exists", () => {
    const first = computeCanvasSize(400, zero);
    assert.ok(first.size);
    const second = computeCanvasSize(600, first.size);
    assert.equal(second.isFirstPaint, false);
    assert.equal(second.changed, true);
  });

  it("reports no change when the size is identical", () => {
    const current = { width: 368, height: 207 };
    const { changed } = computeCanvasSize(368 + CANVAS_PADDING_PX, current);
    assert.equal(changed, false);
  });

  it("rejects a container exactly at the padding width", () => {
    assert.equal(computeCanvasSize(CANVAS_PADDING_PX, zero).size, null);
  });

  it("rejects a negative / hidden container", () => {
    assert.equal(computeCanvasSize(-100, zero).size, null);
    assert.equal(computeCanvasSize(0, zero).size, null);
  });

  // Regression: a container 1px past the padding gave width 1, whose
  // floor(1*9/16) = 0 — a 1×0 canvas used to be accepted.
  it("rejects a width whose derived height floors to zero", () => {
    assert.equal(computeCanvasSize(CANVAS_PADDING_PX + 1, zero).size, null);
  });

  it("accepts the smallest width that yields a non-zero height", () => {
    // width 2 → height floor(2*9/16) = 1
    assert.deepEqual(computeCanvasSize(CANVAS_PADDING_PX + 2, zero).size, { width: 2, height: 1 });
  });

  it("floors a fractional container width", () => {
    const { size } = computeCanvasSize(400.9, zero);
    assert.equal(size?.width, Math.floor(400.9 - CANVAS_PADDING_PX));
  });
});
