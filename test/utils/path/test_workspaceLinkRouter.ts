import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkspacePath } from "../../../src/utils/path/workspaceLinkRouter.js";

describe("classifyWorkspacePath", () => {
  // ── Wiki page links ───────────────────────────────────────

  describe("wiki page links", () => {
    it("classifies data/wiki/pages/<slug>.md as wiki", () => {
      const result = classifyWorkspacePath("data/wiki/pages/my-page.md");
      assert.deepEqual(result, { kind: "wiki", slug: "my-page" });
    });

    it("classifies wiki/pages/<slug>.md (without data/ prefix) as wiki", () => {
      const result = classifyWorkspacePath("wiki/pages/my-page.md");
      assert.deepEqual(result, { kind: "wiki", slug: "my-page" });
    });

    it("extracts multi-segment slug correctly", () => {
      const result = classifyWorkspacePath("data/wiki/pages/some-long-slug-name.md");
      assert.deepEqual(result, { kind: "wiki", slug: "some-long-slug-name" });
    });

    it("does not classify wiki source files as wiki pages", () => {
      const result = classifyWorkspacePath("data/wiki/sources/my-source.md");
      assert.notEqual(result, null);
      assert.equal(result!.kind, "file");
    });

    it("does not classify wiki index as wiki page", () => {
      const result = classifyWorkspacePath("data/wiki/index.md");
      assert.notEqual(result, null);
      assert.equal(result!.kind, "file");
    });
  });

  // ── Session links ─────────────────────────────────────────

  describe("session links", () => {
    it("classifies conversations/chat/<id>.jsonl as session", () => {
      const result = classifyWorkspacePath("conversations/chat/abc-123.jsonl");
      assert.deepEqual(result, { kind: "session", sessionId: "abc-123" });
    });

    it("classifies uuid session id", () => {
      const result = classifyWorkspacePath("conversations/chat/550e8400-e29b-41d4-a716-446655440000.jsonl");
      assert.deepEqual(result, { kind: "session", sessionId: "550e8400-e29b-41d4-a716-446655440000" });
    });

    it("does not classify nested paths under chat/ as session", () => {
      const result = classifyWorkspacePath("conversations/chat/sub/dir.jsonl");
      assert.equal(result!.kind, "file");
    });

    it("does not classify non-jsonl files as session", () => {
      const result = classifyWorkspacePath("conversations/chat/abc-123.txt");
      assert.equal(result!.kind, "file");
    });
  });

  // ── File links ────────────────────────────────────────────

  describe("file links", () => {
    it("classifies generic data/ paths as file", () => {
      const result = classifyWorkspacePath("data/some/file.txt");
      assert.deepEqual(result, { kind: "file", path: "data/some/file.txt" });
    });

    it("classifies config paths as file", () => {
      const result = classifyWorkspacePath("config/settings.json");
      assert.deepEqual(result, { kind: "file", path: "config/settings.json" });
    });

    it("normalizes ./ in paths", () => {
      const result = classifyWorkspacePath("./data/wiki/sources/foo.md");
      assert.deepEqual(result, { kind: "file", path: "data/wiki/sources/foo.md" });
    });
  });

  // ── Null returns (external / invalid) ─────────────────────

  describe("returns null for non-workspace links", () => {
    it("returns null for http URLs", () => {
      assert.equal(classifyWorkspacePath("https://example.com"), null);
    });

    it("returns null for http URLs", () => {
      assert.equal(classifyWorkspacePath("http://example.com/path"), null);
    });

    it("returns null for mailto links", () => {
      assert.equal(classifyWorkspacePath("mailto:user@example.com"), null);
    });

    it("returns null for anchor-only links", () => {
      assert.equal(classifyWorkspacePath("#section"), null);
    });

    it("returns null for empty string", () => {
      assert.equal(classifyWorkspacePath(""), null);
    });

    it("returns null for paths that escape the workspace root", () => {
      assert.equal(classifyWorkspacePath("../../../etc/passwd"), null);
    });

    it("returns null for single ../ that escapes root", () => {
      assert.equal(classifyWorkspacePath("../outside.md"), null);
    });
  });

  // ── Fragment / query stripping ────────────────────────────

  describe("strips fragment and query", () => {
    it("strips #fragment from wiki page link", () => {
      const result = classifyWorkspacePath("data/wiki/pages/my-page.md#section");
      assert.deepEqual(result, { kind: "wiki", slug: "my-page" });
    });

    it("strips ?query from file link", () => {
      const result = classifyWorkspacePath("data/file.txt?v=1");
      assert.deepEqual(result, { kind: "file", path: "data/file.txt" });
    });

    it("strips both fragment and query", () => {
      const result = classifyWorkspacePath("data/wiki/pages/foo.md?bar=1#baz");
      assert.deepEqual(result, { kind: "wiki", slug: "foo" });
    });
  });
});
