// Canonical tests for the shared artifact path builders (#2405). Imports the
// SOURCE (not the built `@mulmoclaude/core/artifacts`) so a broken guard here
// fails without a rebuild. The chart / html / mulmoscript plugins all route
// their path assembly through this module, so these assertions pin the
// filename-slug + partition + workspace-escape behaviour in one place.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACTS_ROOT,
  buildArtifactRelPath,
  hasUnsafePathSegment,
  slugifyArtifact,
  toWorkspaceArtifactPath,
  yearMonthUtc,
} from "../../src/artifacts/paths.ts";

describe("slugifyArtifact", () => {
  it("collapses punctuation and case (happy path)", () => {
    assert.equal(slugifyArtifact("The Life of a Star!", "story"), "the-life-of-a-star");
    assert.equal(slugifyArtifact("The Cell!", "page"), "the-cell");
  });

  it("strips leading/trailing hyphens", () => {
    assert.equal(slugifyArtifact("--hello--", "page"), "hello");
  });

  it("falls back for empty / whitespace / undefined / non-ASCII / punctuation", () => {
    assert.equal(slugifyArtifact(undefined, "story"), "story");
    assert.equal(slugifyArtifact("", "story"), "story");
    assert.equal(slugifyArtifact("   ", "page"), "page");
    assert.equal(slugifyArtifact("星の一生", "story"), "story");
    assert.equal(slugifyArtifact("***", "fb"), "fb");
  });

  it("caps the slug at 120 chars", () => {
    assert.equal(slugifyArtifact("a".repeat(200), "page"), "a".repeat(120));
  });

  it("uses strip -> cap -> strip order (boundary: leading punctuation + overflow keeps 120 real chars)", () => {
    // Deliberate asymmetry vs the old html/mulmoscript cap-then-strip order,
    // which would yield 119 chars here (docs/shared-utils.md). Only titles that
    // BOTH start with punctuation AND exceed 120 chars are affected.
    assert.equal(slugifyArtifact(`!${"a".repeat(130)}`, "page"), "a".repeat(120));
  });
});

describe("yearMonthUtc", () => {
  it("formats a UTC YYYY/MM partition with zero-padded month", () => {
    assert.equal(yearMonthUtc(new Date(Date.UTC(2026, 5, 19, 12, 0, 0))), "2026/06");
    assert.equal(yearMonthUtc(new Date(Date.UTC(2026, 0, 1, 0, 0, 0))), "2026/01");
  });

  it("uses UTC, not local time, at the day boundary", () => {
    assert.equal(yearMonthUtc(new Date("2026-01-01T00:30:00Z")), "2026/01");
  });
});

describe("buildArtifactRelPath", () => {
  const now = new Date(Date.UTC(2026, 5, 19, 12, 0, 0));
  const epochMs = now.getTime();

  it("builds a partitioned <dir>/YYYY/MM/<slug>-<ts><ext> path by default", () => {
    assert.equal(
      buildArtifactRelPath({ dir: "charts", title: "My Chart", ext: ".chart.json", fallback: "chart", now }),
      `charts/2026/06/my-chart-${epochMs}.chart.json`,
    );
    assert.equal(buildArtifactRelPath({ dir: "html", title: "The Cell", ext: ".html", fallback: "page", now }), `html/2026/06/the-cell-${epochMs}.html`);
  });

  it("omits the YYYY/MM partition when partitioned is false", () => {
    assert.equal(
      buildArtifactRelPath({ dir: "stories", title: "My Story", ext: ".json", fallback: "story", now, partitioned: false }),
      `stories/my-story-${epochMs}.json`,
    );
  });

  it("uses the fallback slug for empty / non-ASCII titles", () => {
    assert.equal(
      buildArtifactRelPath({ dir: "stories", title: "星", ext: ".json", fallback: "story", now, partitioned: false }),
      `stories/story-${epochMs}.json`,
    );
    assert.equal(
      buildArtifactRelPath({ dir: "charts", title: undefined, ext: ".chart.json", fallback: "chart", now }),
      `charts/2026/06/chart-${epochMs}.chart.json`,
    );
  });
});

describe("toWorkspaceArtifactPath", () => {
  it("prefixes a FileOps-relative path with the artifacts root", () => {
    assert.equal(toWorkspaceArtifactPath("charts/2026/06/x.chart.json"), "artifacts/charts/2026/06/x.chart.json");
    assert.equal(ARTIFACTS_ROOT, "artifacts");
  });
});

describe("hasUnsafePathSegment", () => {
  it("accepts a clean, canonical path", () => {
    assert.equal(hasUnsafePathSegment("artifacts/html/2026/06/the-cell-1.html"), false);
    assert.equal(hasUnsafePathSegment("stories/foo.json"), false);
  });

  it("rejects traversal, empty, and dot segments", () => {
    assert.equal(hasUnsafePathSegment("artifacts/html/../secret.html"), true);
    assert.equal(hasUnsafePathSegment("artifacts/html//x.html"), true);
    assert.equal(hasUnsafePathSegment("stories/./foo.json"), true);
    assert.equal(hasUnsafePathSegment("/etc/passwd"), true);
    assert.equal(hasUnsafePathSegment("stories/foo/"), true);
    assert.equal(hasUnsafePathSegment(""), true);
  });
});
