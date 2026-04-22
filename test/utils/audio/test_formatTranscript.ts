import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toSegments, formatTranscript } from "../../../src/utils/audio/formatTranscript";

describe("toSegments", () => {
  it("normalises well-formed Whisper chunks", () => {
    const chunks = [
      { timestamp: [0, 2.5], text: " Hello " },
      { timestamp: [2.5, 5.0], text: "world" },
    ];
    const segments = toSegments(chunks);
    assert.deepEqual(segments, [
      { start: 0, end: 2.5, text: "Hello" },
      { start: 2.5, end: 5.0, text: "world" },
    ]);
  });

  it("drops chunks whose text is empty after trimming", () => {
    const segments = toSegments([
      { timestamp: [0, 1], text: "" },
      { timestamp: [1, 2], text: "   " },
      { timestamp: [2, 3], text: "ok" },
    ]);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, "ok");
  });

  it("handles missing or null timestamps by falling back to 0", () => {
    // Whisper occasionally emits `timestamp: [null, null]` or no
    // timestamp at all for a chunk; formatting should still succeed
    // instead of throwing.
    const segments = toSegments([{ timestamp: null, text: "orphan" }, { text: "another" }]);
    assert.equal(segments.length, 2);
    assert.equal(segments[0].start, 0);
    assert.equal(segments[0].end, 0);
  });

  it("returns an empty array for empty input", () => {
    assert.deepEqual(toSegments([]), []);
  });
});

describe("formatTranscript", () => {
  it("formats seconds as m:ss", () => {
    const out = formatTranscript([{ start: 0, end: 4, text: "first" }]);
    assert.equal(out, "[0:00-0:04] first");
  });

  it("pads seconds under 10", () => {
    const out = formatTranscript([{ start: 62, end: 65, text: "after a minute" }]);
    assert.equal(out, "[1:02-1:05] after a minute");
  });

  it("joins multiple segments with newlines", () => {
    const out = formatTranscript([
      { start: 0, end: 4, text: "one" },
      { start: 4, end: 9, text: "two" },
    ]);
    assert.equal(out, "[0:00-0:04] one\n[0:04-0:09] two");
  });

  it("returns '' for zero segments", () => {
    assert.equal(formatTranscript([]), "");
  });

  it("guards against negative / non-finite timestamps", () => {
    // Seen in the wild when Whisper returns an NaN end time for a
    // truncated last segment — we clamp rather than throw.
    const out = formatTranscript([{ start: -1, end: Number.NaN, text: "broken" }]);
    assert.equal(out, "[0:00-0:00] broken");
  });
});
