import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildArtifactPath, buildArtifactPathRandom, yearMonthUtc } from "../../../server/utils/files/naming.js";

describe("yearMonthUtc", () => {
  it("formats as YYYY/MM with zero-padded month", () => {
    assert.equal(yearMonthUtc(new Date(Date.UTC(2026, 0, 15))), "2026/01");
    assert.equal(yearMonthUtc(new Date(Date.UTC(2026, 11, 31))), "2026/12");
  });

  it("uses UTC even when called near a local-time month boundary", () => {
    // 2026-04-30T23:30:00-08:00 is 2026-05-01T07:30:00Z — UTC bucket
    // is May, not April.
    assert.equal(yearMonthUtc(new Date("2026-05-01T07:30:00Z")), "2026/05");
  });

  it("called without args returns the current UTC partition", () => {
    const got = yearMonthUtc();
    assert.match(got, /^\d{4}\/\d{2}$/);
  });
});

describe("buildArtifactPath", () => {
  it("uses slugified title + YYYY/MM partition + timestamp suffix", () => {
    const artifactPath = buildArtifactPath("artifacts/charts", "Sales Q1", ".chart.json", "chart");
    assert.match(artifactPath, /^artifacts\/charts\/\d{4}\/\d{2}\/sales-q1-\d+\.chart\.json$/);
  });

  it("falls back when title is undefined", () => {
    const artifactPath = buildArtifactPath("artifacts/charts", undefined, ".json", "chart");
    assert.match(artifactPath, /^artifacts\/charts\/\d{4}\/\d{2}\/chart-\d+\.json$/);
  });
});

describe("buildArtifactPathRandom", () => {
  it("uses slugified prefix + YYYY/MM partition + 16-char hex suffix", () => {
    const artifactPath = buildArtifactPathRandom("artifacts/documents", "project-summary", ".md", "document");
    assert.match(artifactPath, /^artifacts\/documents\/\d{4}\/\d{2}\/project-summary-[0-9a-f]{16}\.md$/);
  });

  it("slugifies mixed-case / spaces / punctuation", () => {
    const artifactPath = buildArtifactPathRandom("artifacts/documents", "My Report: Draft #2!", ".md", "document");
    assert.match(artifactPath, /^artifacts\/documents\/\d{4}\/\d{2}\/my-report-draft-2-[0-9a-f]{16}\.md$/);
  });

  it("falls back when prefix sanitizes to empty", () => {
    const artifactPath = buildArtifactPathRandom("artifacts/documents", "***", ".md", "document");
    assert.match(artifactPath, /^artifacts\/documents\/\d{4}\/\d{2}\/document-[0-9a-f]{16}\.md$/);
  });

  it("handles non-ASCII prefixes via slugify's hash fallback", () => {
    const artifactPath = buildArtifactPathRandom("artifacts/documents", "進行中", ".md", "document");
    // slugify returns a base64url hash for fully non-ASCII input.
    assert.match(artifactPath, /^artifacts\/documents\/\d{4}\/\d{2}\/[A-Za-z0-9_-]+-[0-9a-f]{16}\.md$/);
  });

  it("produces distinct suffixes across calls with the same prefix", () => {
    const path1 = buildArtifactPathRandom("artifacts/documents", "note", ".md", "document");
    const path2 = buildArtifactPathRandom("artifacts/documents", "note", ".md", "document");
    assert.notEqual(path1, path2);
  });
});
