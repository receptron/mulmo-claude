import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildArtifactPath, buildArtifactPathRandom } from "../../../server/utils/files/naming.js";

describe("buildArtifactPath", () => {
  it("uses slugified title + timestamp suffix", () => {
    const artifactPath = buildArtifactPath("artifacts/charts", "Sales Q1", ".chart.json", "chart");
    assert.match(artifactPath, /^artifacts\/charts\/sales-q1-\d+\.chart\.json$/);
  });

  it("falls back when title is undefined", () => {
    const artifactPath = buildArtifactPath("artifacts/charts", undefined, ".json", "chart");
    assert.match(artifactPath, /^artifacts\/charts\/chart-\d+\.json$/);
  });
});

describe("buildArtifactPathRandom", () => {
  it("uses slugified prefix + 16-char hex suffix", () => {
    const artifactPath = buildArtifactPathRandom("artifacts/documents", "project-summary", ".md", "document");
    assert.match(artifactPath, /^artifacts\/documents\/project-summary-[0-9a-f]{16}\.md$/);
  });

  it("slugifies mixed-case / spaces / punctuation", () => {
    const artifactPath = buildArtifactPathRandom("artifacts/documents", "My Report: Draft #2!", ".md", "document");
    assert.match(artifactPath, /^artifacts\/documents\/my-report-draft-2-[0-9a-f]{16}\.md$/);
  });

  it("falls back when prefix sanitizes to empty", () => {
    const artifactPath = buildArtifactPathRandom("artifacts/documents", "***", ".md", "document");
    assert.match(artifactPath, /^artifacts\/documents\/document-[0-9a-f]{16}\.md$/);
  });

  it("handles non-ASCII prefixes via slugify's hash fallback", () => {
    const artifactPath = buildArtifactPathRandom("artifacts/documents", "進行中", ".md", "document");
    // slugify returns a base64url hash for fully non-ASCII input.
    assert.match(artifactPath, /^artifacts\/documents\/[A-Za-z0-9_-]+-[0-9a-f]{16}\.md$/);
  });

  it("produces distinct suffixes across calls with the same prefix", () => {
    const path1 = buildArtifactPathRandom("artifacts/documents", "note", ".md", "document");
    const path2 = buildArtifactPathRandom("artifacts/documents", "note", ".md", "document");
    assert.notEqual(path1, path2);
  });
});
