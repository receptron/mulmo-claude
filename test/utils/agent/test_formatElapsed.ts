import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatElapsed } from "../../../src/utils/agent/formatElapsed.js";

describe("formatElapsed", () => {
  describe("sub-second", () => {
    it("renders 0ms as '0.0s'", () => {
      // Exact-zero is the boundary for the negative-clamp; render it
      // as 0.0s so the format is consistent with "0.3s", "0.7s".
      assert.equal(formatElapsed(0), "0.0s");
    });

    it("rounds 100ms to one decimal", () => {
      assert.equal(formatElapsed(100), "0.1s");
    });

    it("rounds 333ms to one decimal", () => {
      // toFixed(1) uses banker's rounding edge cases, but 333/1000 =
      // 0.333 → "0.3" deterministically.
      assert.equal(formatElapsed(333), "0.3s");
    });

    it("floors 999ms to '0.9s' (Codex iter-1 #798 — never read ahead of the clock)", () => {
      // Pre-fix: this rendered "1.0s" because `toFixed(1)` rounds
      // half-up. The integer-seconds branch already follows a
      // floor-not-round rule (see test below); the sub-second branch
      // is now consistent — 999ms stays "0.9s" until the very next
      // tick promotes to the integer-second branch.
      assert.equal(formatElapsed(999), "0.9s");
    });

    it("floors 950ms to '0.9s' (no half-up rounding into the next tenth)", () => {
      assert.equal(formatElapsed(950), "0.9s");
    });
  });

  describe("seconds (1s ≤ t < 60s)", () => {
    it("drops the decimal and uses integer seconds", () => {
      assert.equal(formatElapsed(1000), "1s");
      assert.equal(formatElapsed(12_300), "12s");
      assert.equal(formatElapsed(59_999), "59s");
    });

    it("floors rather than rounds (so the badge never reads ahead of the clock)", () => {
      // 12.999s → "12s" not "13s". Users tracking elapsed expect the
      // counter to lag at most 1s, not jump ahead.
      assert.equal(formatElapsed(12_999), "12s");
    });
  });

  describe("minutes (1m ≤ t < 60m)", () => {
    it("renders 'Xm Ys' at the minute boundary", () => {
      assert.equal(formatElapsed(60_000), "1m 0s");
    });

    it("preserves both components when both are non-zero", () => {
      assert.equal(formatElapsed(83_000), "1m 23s");
    });

    it("renders 59m 59s as the upper boundary", () => {
      assert.equal(formatElapsed(60 * 60_000 - 1000), "59m 59s");
    });
  });

  describe("hours (≥ 60m)", () => {
    it("collapses to 'Xh Ym' at the hour boundary", () => {
      // No seconds component: hours/minutes is enough resolution at
      // this scale and the line stays compact.
      assert.equal(formatElapsed(60 * 60_000), "1h 0m");
    });

    it("renders 1h 5m correctly", () => {
      assert.equal(formatElapsed(60 * 60_000 + 5 * 60_000), "1h 5m");
    });

    it("renders multi-digit hours (long-running scheduler runs)", () => {
      assert.equal(formatElapsed(12 * 60 * 60_000 + 30 * 60_000), "12h 30m");
    });
  });

  describe("defensive — negative input", () => {
    it("clamps negatives to zero (clock skew / stale tick safety)", () => {
      // A stale tick that fires after `now` advances less than the
      // accumulator can theoretically yield a negative; we'd rather
      // render "0.0s" than "-3.4s".
      assert.equal(formatElapsed(-1), "0.0s");
      assert.equal(formatElapsed(-12_345), "0.0s");
    });
  });
});
