import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toSafeFilename, formatLocalDate, buildPdfFilename } from "../../../src/utils/files/filename.js";

describe("toSafeFilename", () => {
  it("leaves a clean filename untouched", () => {
    assert.equal(toSafeFilename("project-summary"), "project-summary");
  });

  it("replaces filesystem-hostile chars with underscores", () => {
    assert.equal(toSafeFilename('a/b\\c:d*e?f"g<h>i|j'), "a_b_c_d_e_f_g_h_i_j");
  });

  it("preserves spaces and unicode (safe on modern filesystems)", () => {
    assert.equal(toSafeFilename("プロジェクト 概要"), "プロジェクト 概要");
  });

  it("trims whitespace and falls back when result is empty", () => {
    assert.equal(toSafeFilename("   ", "document"), "document");
  });

  it("uses the default fallback when none is provided", () => {
    assert.equal(toSafeFilename(""), "download");
  });
});

describe("formatLocalDate", () => {
  it("formats a known timestamp as YYYY-MM-DD with zero-padding", () => {
    // Use a Date constructed in local time so the test is timezone-
    // agnostic — the formatter reads local fields, the constructor
    // stores local fields, the round-trip cancels out the offset.
    const timestamp = new Date(2026, 0, 5).getTime(); // Jan 5 2026 local
    assert.equal(formatLocalDate(timestamp), "2026-01-05");
  });

  it("zero-pads December correctly", () => {
    const timestamp = new Date(2026, 11, 31).getTime();
    assert.equal(formatLocalDate(timestamp), "2026-12-31");
  });
});

describe("buildPdfFilename", () => {
  const FIXED_TS = new Date(2026, 3, 26).getTime(); // Apr 26 2026 local

  it("combines safe name with date suffix", () => {
    const filename = buildPdfFilename({ name: "project-summary", fallback: "doc", timestampMs: FIXED_TS });
    assert.equal(filename, "project-summary-2026-04-26.pdf");
  });

  it("falls back when name is empty", () => {
    const filename = buildPdfFilename({ name: "", fallback: "chat", timestampMs: FIXED_TS });
    assert.equal(filename, "chat-2026-04-26.pdf");
  });

  it("falls back when name is null", () => {
    const filename = buildPdfFilename({ name: null, fallback: "doc", timestampMs: FIXED_TS });
    assert.equal(filename, "doc-2026-04-26.pdf");
  });

  it("falls back when name is undefined", () => {
    const filename = buildPdfFilename({ name: undefined, fallback: "doc", timestampMs: FIXED_TS });
    assert.equal(filename, "doc-2026-04-26.pdf");
  });

  it("sanitizes filesystem-hostile chars in name", () => {
    const filename = buildPdfFilename({ name: 'a/b:c*d?e"f', fallback: "doc", timestampMs: FIXED_TS });
    assert.equal(filename, "a_b_c_d_e_f-2026-04-26.pdf");
  });

  it("preserves unicode in name", () => {
    const filename = buildPdfFilename({ name: "プロジェクト概要", fallback: "doc", timestampMs: FIXED_TS });
    assert.equal(filename, "プロジェクト概要-2026-04-26.pdf");
  });

  it("uses Date.now() when timestampMs is omitted", () => {
    const before = Date.now();
    const filename = buildPdfFilename({ name: "x", fallback: "doc" });
    const after = Date.now();
    // Just verify the date in the filename is one of (before, after)'s
    // local dates — typically the same, but tolerate a midnight cross.
    const expectedDates = new Set([formatLocalDate(before), formatLocalDate(after)]);
    const match = /^x-(\d{4}-\d{2}-\d{2})\.pdf$/.exec(filename);
    assert.ok(match, `filename did not match expected shape: ${filename}`);
    assert.ok(expectedDates.has(match[1]), `unexpected date in filename: ${filename}`);
  });
});
