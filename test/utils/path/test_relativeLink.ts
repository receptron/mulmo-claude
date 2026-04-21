import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isExternalHref, resolveWorkspaceLink, extractSessionIdFromPath } from "../../../src/utils/path/relativeLink.js";

describe("isExternalHref", () => {
  it("treats http and https as external", () => {
    assert.equal(isExternalHref("http://example.com"), true);
    assert.equal(isExternalHref("https://example.com/path"), true);
  });

  it("treats mailto and tel as external", () => {
    assert.equal(isExternalHref("mailto:alice@example.com"), true);
    assert.equal(isExternalHref("tel:+123456"), true);
  });

  it("treats ftp as external", () => {
    assert.equal(isExternalHref("ftp://files.example.com"), true);
  });

  it("treats protocol-relative URLs as external", () => {
    assert.equal(isExternalHref("//cdn.example.com/x.js"), true);
  });

  it("treats an unknown scheme as external", () => {
    assert.equal(isExternalHref("vscode://foo"), true);
  });

  it("treats relative paths as internal", () => {
    assert.equal(isExternalHref("../wiki/foo.md"), false);
    assert.equal(isExternalHref("foo.md"), false);
    assert.equal(isExternalHref("./bar.md"), false);
  });

  it("treats workspace-absolute paths as internal", () => {
    assert.equal(isExternalHref("/wiki/foo.md"), false);
    assert.equal(isExternalHref("/html/current.html"), false);
  });

  it("treats anchor-only as internal (the caller handles #)", () => {
    assert.equal(isExternalHref("#section"), false);
  });

  it("treats empty as external (no sense in navigating)", () => {
    assert.equal(isExternalHref(""), true);
  });

  it("treats a path with ':' after a '/' as internal", () => {
    // e.g. "foo/bar:baz.md" — unusual filename but not a URL scheme.
    assert.equal(isExternalHref("foo/bar:baz.md"), false);
  });
});

describe("resolveWorkspaceLink", () => {
  it("resolves a relative link from a topic file into a sibling folder", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "../../wiki/foo.md"), "wiki/foo.md");
  });

  it("resolves a workspace-absolute link", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "/wiki/foo.md"), "wiki/foo.md");
  });

  it("resolves ./sibling.md correctly", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "./bar.md"), "summaries/topics/bar.md");
  });

  it("resolves a bare filename as a sibling", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "bar.md"), "summaries/topics/bar.md");
  });

  it("strips #fragment from the resolved path", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "../../wiki/foo.md#heading"), "wiki/foo.md");
  });

  it("strips ?query from the resolved path", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "../../wiki/foo.md?v=2"), "wiki/foo.md");
  });

  it("returns null for external URLs", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "https://example.com"), null);
  });

  it("returns null for anchor-only links", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "#section"), null);
  });

  it("returns null for an empty href", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", ""), null);
  });

  it("returns null when ../ escapes the workspace root", () => {
    assert.equal(resolveWorkspaceLink("foo.md", "../../../etc/passwd"), null);
  });

  it("returns null when workspace-absolute ../ escapes", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "/../../etc/passwd"), null);
  });

  it("resolves from a deeply-nested daily file", () => {
    assert.equal(resolveWorkspaceLink("summaries/daily/2026/04/11.md", "../../../../wiki/foo.md"), "wiki/foo.md");
  });

  it("handles a file at the workspace root", () => {
    assert.equal(resolveWorkspaceLink("memory.md", "wiki/foo.md"), "wiki/foo.md");
  });

  it("handles dot-dot that lands on a sibling", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "../daily/2026/04/11.md"), "summaries/daily/2026/04/11.md");
  });

  it("collapses redundant ./ segments", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "./././bar.md"), "summaries/topics/bar.md");
  });

  it("returns null for a pure fragment after stripping", () => {
    assert.equal(resolveWorkspaceLink("summaries/topics/foo.md", "?query=1"), null);
  });
});

describe("extractSessionIdFromPath", () => {
  it("extracts a session id from chat/<id>.jsonl", () => {
    assert.equal(extractSessionIdFromPath("chat/abc-123-def.jsonl"), "abc-123-def");
  });

  it("handles a full UUID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    assert.equal(extractSessionIdFromPath(`chat/${uuid}.jsonl`), uuid);
  });

  it("returns null for paths outside chat/", () => {
    assert.equal(extractSessionIdFromPath("wiki/foo.jsonl"), null);
    assert.equal(extractSessionIdFromPath("foo/chat/abc.jsonl"), null);
  });

  it("returns null for non-jsonl extensions", () => {
    assert.equal(extractSessionIdFromPath("chat/abc.md"), null);
    assert.equal(extractSessionIdFromPath("chat/abc.json"), null);
    assert.equal(extractSessionIdFromPath("chat/abc"), null);
  });

  it("returns null when the id portion is empty", () => {
    assert.equal(extractSessionIdFromPath("chat/.jsonl"), null);
  });

  it("returns null for nested paths under chat/", () => {
    assert.equal(extractSessionIdFromPath("chat/subdir/foo.jsonl"), null);
  });

  it("returns null for the bare chat/ directory", () => {
    assert.equal(extractSessionIdFromPath("chat/"), null);
    assert.equal(extractSessionIdFromPath("chat"), null);
  });
});
