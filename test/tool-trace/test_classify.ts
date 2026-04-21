import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_INLINE_CONTENT_CHARS, classifyToolResult } from "../../server/workspace/tool-trace/classify.js";

describe("classifyToolResult — WebSearch", () => {
  it("returns a pointer when searchContentRef is provided", () => {
    const c = classifyToolResult({
      toolName: "WebSearch",
      args: { query: "foo" },
      content: "irrelevant",
      searchContentRef: "conversations/searches/2026-04-13/foo-abc.md",
    });
    assert.deepEqual(c, {
      kind: "pointer",
      contentRef: "conversations/searches/2026-04-13/foo-abc.md",
    });
  });

  it("falls back to inline when no searchContentRef is provided", () => {
    const c = classifyToolResult({
      toolName: "WebSearch",
      args: { query: "foo" },
      content: "raw body",
    });
    assert.equal(c.kind, "inline");
  });
});

describe("classifyToolResult — file-pointer tools", () => {
  for (const toolName of ["Read", "Write", "Edit"]) {
    it(`${toolName} with file_path → pointer`, () => {
      const c = classifyToolResult({
        toolName,
        args: { file_path: "wiki/pages/foo.md" },
        content: "content should be ignored",
      });
      assert.deepEqual(c, {
        kind: "pointer",
        contentRef: "wiki/pages/foo.md",
      });
    });
  }

  it("normalises leading ./ in file_path", () => {
    const c = classifyToolResult({
      toolName: "Read",
      args: { file_path: "./chat/foo.jsonl" },
      content: "",
    });
    assert.deepEqual(c, { kind: "pointer", contentRef: "chat/foo.jsonl" });
  });

  it("normalises leading / in file_path", () => {
    const c = classifyToolResult({
      toolName: "Read",
      args: { file_path: "/wiki/index.md" },
      content: "",
    });
    assert.deepEqual(c, { kind: "pointer", contentRef: "wiki/index.md" });
  });

  it("falls back to inline when file_path is absent/non-string", () => {
    const c = classifyToolResult({
      toolName: "Read",
      args: {},
      content: "some content",
    });
    assert.equal(c.kind, "inline");
  });
});

describe("classifyToolResult — image tools", () => {
  it("generateImage with filePath in content → pointer", () => {
    const c = classifyToolResult({
      toolName: "generateImage",
      args: { prompt: "cat" },
      content: '{"filePath": "images/cat-123.png", "size": 1024}',
    });
    assert.deepEqual(c, {
      kind: "pointer",
      contentRef: "images/cat-123.png",
    });
  });

  it("editImage with path key in content → pointer", () => {
    const c = classifyToolResult({
      toolName: "editImage",
      args: {},
      content: '{"path": "images/edit-abc.png"}',
    });
    assert.deepEqual(c, {
      kind: "pointer",
      contentRef: "images/edit-abc.png",
    });
  });

  it("falls back to inline when image content has no path key", () => {
    const c = classifyToolResult({
      toolName: "generateImage",
      args: {},
      content: "no path here",
    });
    assert.equal(c.kind, "inline");
  });
});

describe("classifyToolResult — inline truncation", () => {
  it("short content is inlined verbatim, not truncated", () => {
    const c = classifyToolResult({
      toolName: "Bash",
      args: { command: "ls" },
      content: "foo.md\nbar.md",
    });
    assert.deepEqual(c, {
      kind: "inline",
      content: "foo.md\nbar.md",
      truncated: false,
    });
  });

  it("content exactly at MAX is inlined, not truncated", () => {
    const content = "a".repeat(MAX_INLINE_CONTENT_CHARS);
    const c = classifyToolResult({
      toolName: "Bash",
      args: {},
      content,
    });
    assert.equal(c.kind, "inline");
    if (c.kind === "inline") {
      assert.equal(c.content.length, MAX_INLINE_CONTENT_CHARS);
      assert.equal(c.truncated, false);
    }
  });

  it("one char over MAX → truncated to MAX", () => {
    const content = "a".repeat(MAX_INLINE_CONTENT_CHARS + 1);
    const c = classifyToolResult({
      toolName: "Bash",
      args: {},
      content,
    });
    assert.equal(c.kind, "inline");
    if (c.kind === "inline") {
      assert.equal(c.content.length, MAX_INLINE_CONTENT_CHARS);
      assert.equal(c.truncated, true);
    }
  });

  it("WebFetch huge body → truncated", () => {
    const content = "x".repeat(MAX_INLINE_CONTENT_CHARS * 3);
    const c = classifyToolResult({
      toolName: "WebFetch",
      args: { url: "https://example.com" },
      content,
    });
    assert.equal(c.kind, "inline");
    if (c.kind === "inline") assert.equal(c.truncated, true);
  });

  it("empty content is inlined as empty string, not truncated", () => {
    const c = classifyToolResult({
      toolName: "Bash",
      args: {},
      content: "",
    });
    assert.deepEqual(c, { kind: "inline", content: "", truncated: false });
  });

  it("unknown tool name defaults to inline behaviour", () => {
    const c = classifyToolResult({
      toolName: "SomeRandomTool",
      args: {},
      content: "hello",
    });
    assert.deepEqual(c, { kind: "inline", content: "hello", truncated: false });
  });
});
