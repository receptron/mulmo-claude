import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  entryToExcerpt,
  extractArtifactPaths,
  parseEntry,
} from "../../server/journal/dailyPass.js";

describe("entryToExcerpt", () => {
  it("converts a text entry", () => {
    const out = entryToExcerpt({
      source: "user",
      type: "text",
      message: "hello",
    });
    assert.deepEqual(out, {
      source: "user",
      type: "text",
      content: "hello",
    });
  });

  it("truncates very long text messages", () => {
    const longMsg = "x".repeat(2000);
    const out = entryToExcerpt({
      source: "assistant",
      type: "text",
      message: longMsg,
    });
    assert.ok(out);
    assert.ok(out!.content.length < longMsg.length);
    assert.ok(out!.content.endsWith("…"));
  });

  it("converts a tool_result entry using toolName + title", () => {
    const out = entryToExcerpt({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "generateImage",
        title: "a sunset",
        message: "full message",
      },
    });
    assert.ok(out);
    assert.match(out!.content, /generateImage: a sunset/);
  });

  it("falls back to message when title is missing", () => {
    const out = entryToExcerpt({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "searchX",
        message: "got 10 results",
      },
    });
    assert.ok(out);
    assert.match(out!.content, /searchX: got 10 results/);
  });

  it("falls back to '(no message)' when both title and message are missing", () => {
    const out = entryToExcerpt({
      source: "tool",
      type: "tool_result",
      result: { toolName: "weird" },
    });
    assert.ok(out);
    assert.match(out!.content, /weird: \(no message\)/);
  });

  it("returns null for unrecognised entry types", () => {
    assert.equal(
      entryToExcerpt({ source: "user", type: "mystery", message: "x" }),
      null,
    );
  });

  it("returns null for text entries with no message", () => {
    assert.equal(entryToExcerpt({ source: "user", type: "text" }), null);
  });

  it("returns null for tool_result with non-object result", () => {
    assert.equal(
      entryToExcerpt({ source: "tool", type: "tool_result", result: "str" }),
      null,
    );
  });

  it("handles missing source/type by using 'unknown'", () => {
    const out = entryToExcerpt({ message: "hi", type: "text" });
    assert.ok(out);
    assert.equal(out!.source, "unknown");
  });
});

describe("extractArtifactPaths", () => {
  it("returns [] for text entries", () => {
    assert.deepEqual(
      extractArtifactPaths({ source: "user", type: "text", message: "hi" }),
      [],
    );
  });

  it("extracts data.filePath from a tool_result", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentMulmoScript",
        data: { filePath: "stories/foo.json" },
      },
    });
    assert.deepEqual(paths, ["stories/foo.json"]);
  });

  it("synthesises a wiki page path from manageWiki + pageName", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "manageWiki",
        data: { action: "view", pageName: "refactoring" },
      },
    });
    assert.deepEqual(paths, ["wiki/pages/refactoring.md"]);
  });

  it("extracts from presentHtml via data.filePath", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentHtml",
        data: { filePath: "HTMLs/report.html" },
      },
    });
    assert.deepEqual(paths, ["HTMLs/report.html"]);
  });

  it("rejects absolute paths in filePath", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentHtml",
        data: { filePath: "/etc/passwd" },
      },
    });
    assert.deepEqual(paths, []);
  });

  it("rejects parent-escape paths in filePath", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentHtml",
        data: { filePath: "../../etc/passwd" },
      },
    });
    assert.deepEqual(paths, []);
  });

  it("rejects scheme-looking paths in filePath", () => {
    const paths = extractArtifactPaths({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "foo",
        data: { filePath: "https://example.com/x" },
      },
    });
    assert.deepEqual(paths, []);
  });

  it("returns [] when data is missing", () => {
    assert.deepEqual(
      extractArtifactPaths({
        source: "tool",
        type: "tool_result",
        result: { toolName: "presentHtml" },
      }),
      [],
    );
  });

  it("returns [] for non-tool_result entries", () => {
    assert.deepEqual(
      extractArtifactPaths({
        type: "other",
        result: { data: { filePath: "x" } },
      }),
      [],
    );
  });
});

describe("parseEntry", () => {
  it("returns excerpt plus artifactPaths for a tool_result", () => {
    const parsed = parseEntry({
      source: "tool",
      type: "tool_result",
      result: {
        toolName: "presentMulmoScript",
        title: "story about a cat",
        data: { filePath: "stories/cat.json" },
      },
    });
    assert.ok(parsed);
    assert.match(
      parsed!.excerpt.content,
      /presentMulmoScript: story about a cat/,
    );
    assert.deepEqual(parsed!.artifactPaths, ["stories/cat.json"]);
  });

  it("returns empty artifactPaths for a text entry", () => {
    const parsed = parseEntry({ source: "user", type: "text", message: "hi" });
    assert.ok(parsed);
    assert.deepEqual(parsed!.artifactPaths, []);
  });

  it("returns null for entries that don't produce an excerpt", () => {
    assert.equal(parseEntry({ source: "x", type: "mystery" }), null);
  });
});
