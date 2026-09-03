import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAbsoluteStoryPath, normalizeStoryPath, slugify, storyFilePath, STORY_SCRIPT_EXTENSIONS, STORY_TARGET_EXTENSIONS } from "../src/core/paths";

describe("slugify", () => {
  it("collapses punctuation and case", () => {
    assert.equal(slugify("The Life of a Star!"), "the-life-of-a-star");
  });

  it("falls back for empty / undefined / non-ASCII-only input", () => {
    assert.equal(slugify(undefined), "story");
    assert.equal(slugify(""), "story");
    assert.equal(slugify("星の一生"), "story");
  });

  it("strips leading/trailing hyphens", () => {
    assert.equal(slugify("--hello--"), "hello");
  });
});

describe("storyFilePath", () => {
  it("builds stories/<slug>-<epoch>.json", () => {
    const now = new Date(1700000000000);
    assert.equal(storyFilePath("My Story", now), "stories/my-story-1700000000000.json");
  });
});

describe("normalizeStoryPath", () => {
  it("accepts the canonical stories/ form", () => {
    assert.equal(normalizeStoryPath("stories/foo.json"), "stories/foo.json");
  });

  it("accepts a bare filename and re-roots it under stories/", () => {
    assert.equal(normalizeStoryPath("foo.json"), "stories/foo.json");
  });

  it("accepts nested paths", () => {
    assert.equal(normalizeStoryPath("stories/__movies__/bar.mp4"), "stories/__movies__/bar.mp4");
  });

  it("accepts the workspace-relative artifacts/stories/ spelling", () => {
    assert.equal(normalizeStoryPath("artifacts/stories/foo.json"), "stories/foo.json");
    assert.equal(normalizeStoryPath("artifacts/stories/__movies__/bar.mp4"), "stories/__movies__/bar.mp4");
  });

  it("keeps a bare artifacts/ segment as a name under stories/", () => {
    assert.equal(normalizeStoryPath("artifacts/foo.json"), "stories/artifacts/foo.json");
  });

  it("rejects artifacts/stories with no remainder", () => {
    assert.equal(normalizeStoryPath("artifacts/stories"), null);
  });

  it("rejects traversal, absolute, and non-canonical segments", () => {
    assert.equal(normalizeStoryPath("../secrets.json"), null);
    assert.equal(normalizeStoryPath("stories/../../etc/passwd"), null);
    assert.equal(normalizeStoryPath("/etc/passwd"), null);
    assert.equal(normalizeStoryPath("C:/windows/system32"), null);
    assert.equal(normalizeStoryPath("stories//foo.json"), null);
    assert.equal(normalizeStoryPath("stories/./foo.json"), null);
    assert.equal(normalizeStoryPath("stories\\foo.json"), null);
    assert.equal(normalizeStoryPath(""), null);
    assert.equal(normalizeStoryPath("stories"), null);
  });
});

describe("isAbsoluteStoryPath — the absolute `filePath` form", () => {
  it("accepts an absolute POSIX path to a .json script", () => {
    assert.equal(isAbsoluteStoryPath("/Users/me/decks/keynote.json"), true);
  });

  it("accepts a Windows path even on POSIX", () => {
    // The value may arrive from a remote host, so the LEXICAL gate is
    // platform-independent. Whether it is absolute on THIS machine is the
    // server's question (`resolveStory` requires native absoluteness).
    assert.equal(isAbsoluteStoryPath("C:\\projects\\deck.json"), true);
  });

  it("refuses a relative path — that form keeps its stories-dir meaning", () => {
    assert.equal(isAbsoluteStoryPath("stories/deck.json"), false);
    assert.equal(isAbsoluteStoryPath("deck.json"), false);
  });

  it("refuses traversal, empty segments and NUL", () => {
    assert.equal(isAbsoluteStoryPath("/a/../b/deck.json"), false);
    assert.equal(isAbsoluteStoryPath("/a/./deck.json"), false);
    assert.equal(isAbsoluteStoryPath("/a//deck.json"), false);
    assert.equal(isAbsoluteStoryPath("/a/deck\0.json"), false);
  });

  it("refuses an extension outside the requested set", () => {
    assert.equal(isAbsoluteStoryPath("/a/deck.md"), false);
    assert.equal(isAbsoluteStoryPath("/a/deck.mp4"), false);
    // …but the wider set the server mints wire refs in accepts the media.
    assert.equal(isAbsoluteStoryPath("/a/deck.mp4", STORY_TARGET_EXTENSIONS), true);
    assert.equal(isAbsoluteStoryPath("/a/deck.mov", STORY_TARGET_EXTENSIONS), true);
    assert.equal(isAbsoluteStoryPath("/a/deck.pdf", STORY_TARGET_EXTENSIONS), true);
    assert.equal(isAbsoluteStoryPath("/a/deck.json", STORY_TARGET_EXTENSIONS), true);
  });

  it("STORY_SCRIPT_EXTENSIONS is the default set", () => {
    assert.deepEqual([...STORY_SCRIPT_EXTENSIONS], [".json"]);
  });
});
