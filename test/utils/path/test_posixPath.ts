import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripFragmentAndQuery, normalizeWorkspacePath } from "../../../src/utils/path/posixPath.js";

describe("stripFragmentAndQuery", () => {
  it("returns the string unchanged when neither marker is present", () => {
    assert.equal(stripFragmentAndQuery("data/wiki/pages/foo.md"), "data/wiki/pages/foo.md");
  });

  it("cuts at a fragment", () => {
    assert.equal(stripFragmentAndQuery("data/wiki/pages/foo.md#section"), "data/wiki/pages/foo.md");
  });

  it("cuts at a query", () => {
    assert.equal(stripFragmentAndQuery("data/file.txt?v=1"), "data/file.txt");
  });

  it("cuts at the query when '?' comes before '#'", () => {
    assert.equal(stripFragmentAndQuery("data/foo.md?bar=1#baz"), "data/foo.md");
  });

  it("cuts at the fragment when '#' comes before '?'", () => {
    assert.equal(stripFragmentAndQuery("data/foo.md#baz?bar=1"), "data/foo.md");
  });

  it("returns empty for a pure fragment or pure query", () => {
    assert.equal(stripFragmentAndQuery("#section"), "");
    assert.equal(stripFragmentAndQuery("?v=1"), "");
  });

  it("returns empty for an empty string", () => {
    assert.equal(stripFragmentAndQuery(""), "");
  });

  it("keeps markers that appear only after the first one", () => {
    assert.equal(stripFragmentAndQuery("a#b#c"), "a");
    assert.equal(stripFragmentAndQuery("a?b?c"), "a");
  });
});

describe("normalizeWorkspacePath", () => {
  describe("root-escape rejection (workspace confinement)", () => {
    it("returns null when '..' pops past the root", () => {
      assert.equal(normalizeWorkspacePath("../../etc/passwd"), null);
    });

    it("returns null for a single leading '..'", () => {
      assert.equal(normalizeWorkspacePath("../foo.md"), null);
    });

    it("returns null when '..' escapes mid-path after consuming the stack", () => {
      assert.equal(normalizeWorkspacePath("a/../../etc/passwd"), null);
    });

    it("returns null even when the escape is disguised by './' segments", () => {
      assert.equal(normalizeWorkspacePath("./a/./../../etc/passwd"), null);
    });

    it("allows '..' that stays inside the root", () => {
      assert.equal(normalizeWorkspacePath("a/b/../c"), "a/c");
      assert.equal(normalizeWorkspacePath("summaries/topics/../daily/1.md"), "summaries/daily/1.md");
    });
  });

  describe("empty / dot-only results", () => {
    it("returns null for an empty string", () => {
      assert.equal(normalizeWorkspacePath(""), null);
    });

    it("returns null for '.' only", () => {
      assert.equal(normalizeWorkspacePath("."), null);
      assert.equal(normalizeWorkspacePath("./././"), null);
    });

    it("returns null for slashes only", () => {
      assert.equal(normalizeWorkspacePath("/"), null);
      assert.equal(normalizeWorkspacePath("///"), null);
    });

    it("returns null when '..' cancels the whole path", () => {
      assert.equal(normalizeWorkspacePath("a/.."), null);
    });
  });

  describe("segment collapsing", () => {
    it("drops a trailing slash", () => {
      assert.equal(normalizeWorkspacePath("a/b/"), "a/b");
    });

    it("collapses consecutive slashes", () => {
      assert.equal(normalizeWorkspacePath("a//b///c"), "a/b/c");
    });

    it("drops a leading slash", () => {
      assert.equal(normalizeWorkspacePath("/a/b"), "a/b");
    });

    it("drops '.' segments", () => {
      assert.equal(normalizeWorkspacePath("./a/./b"), "a/b");
    });

    it("passes an already-normal path through unchanged", () => {
      assert.equal(normalizeWorkspacePath("data/wiki/pages/foo.md"), "data/wiki/pages/foo.md");
    });

    it("keeps a single segment", () => {
      assert.equal(normalizeWorkspacePath("memory.md"), "memory.md");
    });
  });

  describe("segments that only look like traversal", () => {
    it("treats '...' and '..foo' as ordinary segments", () => {
      assert.equal(normalizeWorkspacePath("a/.../b"), "a/.../b");
      assert.equal(normalizeWorkspacePath("a/..foo/b"), "a/..foo/b");
    });

    it("treats a dotfile as an ordinary segment", () => {
      assert.equal(normalizeWorkspacePath(".gitignore"), ".gitignore");
    });

    it("does not treat a backslash as a separator (POSIX only)", () => {
      assert.equal(normalizeWorkspacePath("a\\..\\b"), "a\\..\\b");
    });
  });
});
