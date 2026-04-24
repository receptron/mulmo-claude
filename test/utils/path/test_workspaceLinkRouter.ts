import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkspacePath, resolveWikiHref } from "../../../src/utils/path/workspaceLinkRouter.js";

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

  // ── Wiki relative path resolution ─────────────────────────
  // Wiki pages link to sources/sessions with relative paths like
  // `../sources/foo.md`. The wiki View prepends `data/wiki/pages/`
  // before calling classifyWorkspacePath so that `../` segments
  // resolve correctly against the wiki page's filesystem location.

  describe("wiki relative paths (pre-resolved with data/wiki/pages/ prefix)", () => {
    it("resolves ../sources/<name>.md to a file", () => {
      const resolved = "data/wiki/pages/../sources/my-source.md";
      const result = classifyWorkspacePath(resolved);
      assert.deepEqual(result, { kind: "file", path: "data/wiki/sources/my-source.md" });
    });

    it("resolves ../../../conversations/chat/<id>.jsonl to a session", () => {
      const resolved = "data/wiki/pages/../../../conversations/chat/550e8400-e29b-41d4-a716-446655440000.jsonl";
      const result = classifyWorkspacePath(resolved);
      assert.deepEqual(result, { kind: "session", sessionId: "550e8400-e29b-41d4-a716-446655440000" });
    });

    it("resolves ./other-page.md to a wiki page", () => {
      const resolved = "data/wiki/pages/./other-page.md";
      const result = classifyWorkspacePath(resolved);
      assert.deepEqual(result, { kind: "wiki", slug: "other-page" });
    });

    it("resolves sibling page reference (no prefix needed)", () => {
      const resolved = "data/wiki/pages/sibling.md";
      const result = classifyWorkspacePath(resolved);
      assert.deepEqual(result, { kind: "wiki", slug: "sibling" });
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

describe("resolveWikiHref", () => {
  const PAGES_BASE = "data/wiki/pages";
  const WIKI_BASE = "data/wiki";

  describe("relative paths (./ and ../)", () => {
    it("prepends baseDir for ../ paths", () => {
      assert.equal(resolveWikiHref("../sources/foo.md", PAGES_BASE), "data/wiki/pages/../sources/foo.md");
    });

    it("prepends baseDir for ./ paths", () => {
      assert.equal(resolveWikiHref("./sibling.md", PAGES_BASE), "data/wiki/pages/./sibling.md");
    });

    it("uses wiki base for log-relative paths", () => {
      assert.equal(resolveWikiHref("./pages/foo.md", WIKI_BASE), "data/wiki/./pages/foo.md");
    });
  });

  describe("bare filenames (no /)", () => {
    it("treats bare .md filename as relative", () => {
      assert.equal(resolveWikiHref("sibling.md", PAGES_BASE), "data/wiki/pages/sibling.md");
    });

    it("treats bare name without extension as relative", () => {
      assert.equal(resolveWikiHref("config", PAGES_BASE), "data/wiki/pages/config");
    });
  });

  describe("external schemes (must pass through unchanged)", () => {
    it("passes through mailto: links", () => {
      assert.equal(resolveWikiHref("mailto:user@example.com", PAGES_BASE), "mailto:user@example.com");
    });

    it("passes through tel: links", () => {
      assert.equal(resolveWikiHref("tel:+819012345678", PAGES_BASE), "tel:+819012345678");
    });

    it("passes through custom scheme links", () => {
      assert.equal(resolveWikiHref("slack://channel/general", PAGES_BASE), "slack://channel/general");
    });

    it("passes through https: links", () => {
      assert.equal(resolveWikiHref("https://example.com", PAGES_BASE), "https://example.com");
    });
  });

  describe("absolute workspace paths (contains /)", () => {
    it("passes through workspace-root-relative paths unchanged", () => {
      assert.equal(resolveWikiHref("data/wiki/sources/foo.md", PAGES_BASE), "data/wiki/sources/foo.md");
    });

    it("passes through conversations path unchanged", () => {
      assert.equal(resolveWikiHref("conversations/chat/abc.jsonl", PAGES_BASE), "conversations/chat/abc.jsonl");
    });
  });
});
