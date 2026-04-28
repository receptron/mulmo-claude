// Unit tests for the new wiki-pages choke-point write helper
// (#763 PR 1). The actual snapshot pipeline is no-op in PR 1 so the
// behaviours we lock in are:
//
//   - reads/writes hit the right path under the workspace root
//   - read returns null for missing files (no throw)
//   - writes are atomic (no leftover .tmp files after success)
//   - classifyAsWikiPage routes the generic file PUT correctly,
//     including refusing nested / non-md / outside-root paths

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { classifyAsWikiPage, readWikiPage, wikiPagePath, writeWikiPage } from "../../../server/workspace/wiki-pages/io.js";
import { parseFrontmatter } from "../../../server/utils/markdown/frontmatter.js";
import { WORKSPACE_DIRS } from "../../../server/workspace/paths.js";

/** Helper: a fixed `now` injector so frontmatter timestamps are
 *  deterministic across tests. */
const FIXED_NOW = new Date("2026-04-27T12:34:56.789Z");
const fixedNow = () => FIXED_NOW;

describe("wiki-pages/io — wikiPagePath", () => {
  it("composes data/wiki/pages/<slug>.md under the given workspaceRoot", () => {
    const root = "/tmp/ws-test";
    const out = wikiPagePath("my-page", { workspaceRoot: root });
    // path.join collapses redundant separators and uses the platform
    // separator. Compare via path.normalize on both sides for
    // cross-platform safety.
    const expected = path.join(root, WORKSPACE_DIRS.wikiPages, "my-page.md");
    assert.equal(out, expected);
  });

  it("accepts unicode slugs (e.g. CJK page names)", () => {
    // Wiki has Japanese page slugs in production — the safety guard
    // must not over-reject the legitimate ones.
    const out = wikiPagePath("さくらインターネット", { workspaceRoot: "/tmp/ws" });
    assert.equal(out, path.join("/tmp/ws", WORKSPACE_DIRS.wikiPages, "さくらインターネット.md"));
  });

  it("throws on path-traversal slugs (..)", () => {
    // Defensive — today's callers all use path.basename so they're
    // safe, but the chokepoint must reject if a future caller forgets.
    assert.throws(() => wikiPagePath("../../etc/passwd", { workspaceRoot: "/tmp/ws" }), /unsafe slug/);
  });

  it("throws on slugs containing forward slashes", () => {
    assert.throws(() => wikiPagePath("nested/page", { workspaceRoot: "/tmp/ws" }), /unsafe slug/);
  });

  it("throws on slugs containing backslashes (Windows traversal)", () => {
    assert.throws(() => wikiPagePath("evil\\..\\foo", { workspaceRoot: "/tmp/ws" }), /unsafe slug/);
  });

  it("accepts dot-prefixed slugs (e.g. existing `.foo.md` files)", () => {
    // Codex iter-2 #883: previously rejected. Aesthetic concern,
    // not security — pre-existing dotfile pages must keep working
    // through the chokepoint.
    const out = wikiPagePath(".gitignore", { workspaceRoot: "/tmp/ws" });
    assert.equal(out, path.join("/tmp/ws", WORKSPACE_DIRS.wikiPages, ".gitignore.md"));
  });

  it("throws on `.` / `..` slugs (resolve outside or into pagesDir itself)", () => {
    assert.throws(() => wikiPagePath(".", { workspaceRoot: "/tmp/ws" }), /unsafe slug/);
    assert.throws(() => wikiPagePath("..", { workspaceRoot: "/tmp/ws" }), /unsafe slug/);
  });

  it("throws on the empty slug", () => {
    assert.throws(() => wikiPagePath("", { workspaceRoot: "/tmp/ws" }), /unsafe slug/);
  });

  it("throws on slugs with NUL bytes", () => {
    assert.throws(() => wikiPagePath("foo\0bar", { workspaceRoot: "/tmp/ws" }), /unsafe slug/);
  });
});

describe("wiki-pages/io — readWikiPage", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "wiki-pages-read-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("returns the file content when the page exists", async () => {
    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    await mkdir(pagesDir, { recursive: true });
    await writeFile(path.join(pagesDir, "topic.md"), "# Topic\n\nbody\n", "utf-8");

    const out = await readWikiPage("topic", { workspaceRoot });
    assert.equal(out, "# Topic\n\nbody\n");
  });

  it("returns null when the page does not exist (no throw)", async () => {
    const out = await readWikiPage("nonexistent", { workspaceRoot });
    assert.equal(out, null);
  });
});

describe("wiki-pages/io — writeWikiPage", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "wiki-pages-write-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("creates a new page when none exists, stamping created/updated/editor", async () => {
    await writeWikiPage("brand-new", "# Brand New\n\nfresh\n", { editor: "user" }, { workspaceRoot, now: fixedNow });

    const fileContent = await readFile(wikiPagePath("brand-new", { workspaceRoot }), "utf-8");
    const parsed = parseFrontmatter(fileContent);
    assert.equal(parsed.hasHeader, true);
    assert.equal(parsed.body, "# Brand New\n\nfresh\n");
    assert.equal(parsed.meta.created, "2026-04-27");
    assert.equal(parsed.meta.updated, "2026-04-27T12:34:56.789Z");
    assert.equal(parsed.meta.editor, "user");
  });

  it("overwrites an existing page; created stays sticky, updated bumps", async () => {
    const earlier = new Date("2026-04-26T10:00:00.000Z");
    const later = new Date("2026-04-27T15:30:00.000Z");
    await writeWikiPage("topic-x", "v1\n", { editor: "user" }, { workspaceRoot, now: () => earlier });
    await writeWikiPage("topic-x", "v2\n", { editor: "llm", sessionId: "s1" }, { workspaceRoot, now: () => later });

    const fileContent = await readFile(wikiPagePath("topic-x", { workspaceRoot }), "utf-8");
    const parsed = parseFrontmatter(fileContent);
    assert.equal(parsed.body, "v2\n");
    assert.equal(parsed.meta.created, "2026-04-26"); // first save's date — sticky
    assert.equal(parsed.meta.updated, "2026-04-27T15:30:00.000Z"); // second save's instant
    assert.equal(parsed.meta.editor, "llm"); // last writer
  });

  it("preserves unknown frontmatter keys across saves", async () => {
    // First save: bring an existing page with custom frontmatter
    // into being, simulating a hand-edited file already on disk.
    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    await mkdir(pagesDir, { recursive: true });
    const seedPath = path.join(pagesDir, "with-extras.md");
    await writeFile(seedPath, "---\ntitle: Has Title\nprerequisites: Node 22+\ntags: [demo, custom]\n---\n\noriginal body\n", "utf-8");

    // User saves a new body — auto-stamped fields appear, but
    // `title` / `prerequisites` / `tags` survive verbatim.
    await writeWikiPage("with-extras", "updated body\n", { editor: "user" }, { workspaceRoot, now: fixedNow });

    const fileContent = await readFile(wikiPagePath("with-extras", { workspaceRoot }), "utf-8");
    const parsed = parseFrontmatter(fileContent);
    assert.equal(parsed.body, "updated body\n");
    assert.equal(parsed.meta.title, "Has Title");
    assert.equal(parsed.meta.prerequisites, "Node 22+");
    assert.deepEqual(parsed.meta.tags, ["demo", "custom"]);
    assert.equal(parsed.meta.created, "2026-04-27"); // first writeWikiPage save (file pre-existed but had no `created`)
    assert.equal(parsed.meta.updated, "2026-04-27T12:34:56.789Z");
    assert.equal(parsed.meta.editor, "user");
  });

  it("accepts caller-supplied frontmatter and merges with auto-stamps", async () => {
    // manageWiki MCP can send `---\nprerequisites: …\n---\nbody`
    // and the new frontmatter merges into whatever's already on
    // disk. Auto-stamps still land on top.
    const incoming = "---\nprerequisites: Node 22+\nupdated: '2020-01-01'\n---\n\nfrom MCP\n";
    await writeWikiPage("from-mcp", incoming, { editor: "llm", sessionId: "s1" }, { workspaceRoot, now: fixedNow });

    const fileContent = await readFile(wikiPagePath("from-mcp", { workspaceRoot }), "utf-8");
    const parsed = parseFrontmatter(fileContent);
    assert.equal(parsed.body, "from MCP\n");
    assert.equal(parsed.meta.prerequisites, "Node 22+");
    // The caller's `updated: '2020-01-01'` is overwritten by the
    // auto-stamp — that field is owned by writeWikiPage.
    assert.equal(parsed.meta.updated, "2026-04-27T12:34:56.789Z");
    assert.equal(parsed.meta.editor, "llm");
  });

  it("does not leave a .tmp staging file after a successful write", async () => {
    await writeWikiPage("clean", "content\n", { editor: "user" }, { workspaceRoot, now: fixedNow });

    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    const entries = await readdir(pagesDir);
    const stragglers = entries.filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(stragglers, []);
  });

  it("isolates concurrent writes via uniqueTmp (no .tmp collision)", async () => {
    // Two concurrent writes to the same slug must each use a
    // different staging filename, otherwise one will fail with
    // ENOENT mid-rename. The test for uniqueTmp is observable as
    // "both writes complete without throwing".
    const writes = Promise.all([
      writeWikiPage("race", "writer-a\n", { editor: "user" }, { workspaceRoot, now: fixedNow }),
      writeWikiPage("race", "writer-b\n", { editor: "system", sessionId: "s" }, { workspaceRoot, now: fixedNow }),
    ]);
    await assert.doesNotReject(writes);

    // The final content is one of the two bodies — we don't assert
    // which because rename order is racey. We only assert that the
    // serialised body parses to `writer-a\n` or `writer-b\n`.
    const final = await readFile(wikiPagePath("race", { workspaceRoot }), "utf-8");
    const body = parseFrontmatter(final).body;
    assert.ok(body === "writer-a\n" || body === "writer-b\n", `unexpected body: ${body}`);
  });

  it("records the editor identity per call site (llm / user / system)", async () => {
    await writeWikiPage("by-llm", "llm content\n", { editor: "llm", sessionId: "s1" }, { workspaceRoot, now: fixedNow });
    await writeWikiPage("by-system", "system content\n", { editor: "system", sessionId: "s2" }, { workspaceRoot, now: fixedNow });

    const llmFile = await readFile(wikiPagePath("by-llm", { workspaceRoot }), "utf-8");
    const sysFile = await readFile(wikiPagePath("by-system", { workspaceRoot }), "utf-8");
    assert.equal(parseFrontmatter(llmFile).meta.editor, "llm");
    assert.equal(parseFrontmatter(sysFile).meta.editor, "system");
  });
});

describe("wiki-pages/io — classifyAsWikiPage", () => {
  const root = "/tmp/ws-classify";
  const pagesDir = path.join(root, WORKSPACE_DIRS.wikiPages);

  it("classifies a direct child .md as wiki", () => {
    const out = classifyAsWikiPage(path.join(pagesDir, "foo.md"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: true, slug: "foo" });
  });

  it("rejects index.md (lives one level above pages/)", () => {
    const out = classifyAsWikiPage(path.join(root, "data", "wiki", "index.md"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects non-md files inside pages/", () => {
    const out = classifyAsWikiPage(path.join(pagesDir, "foo.txt"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects nested subdirectories under pages/", () => {
    // No nested wiki layout today; reject defensively.
    const out = classifyAsWikiPage(path.join(pagesDir, "subdir", "foo.md"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects path traversal attempts (.. escapes pagesDir)", () => {
    const malicious = path.join(pagesDir, "..", "..", "secrets.md");
    const out = classifyAsWikiPage(malicious, { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("accepts page names whose basename starts with `..` (e.g. `..foo.md`)", () => {
    // Codex iter-3 #883: an over-strict `rel.startsWith("..")` rule
    // would have wrongly rejected this legitimate single-segment
    // filename. The proper escape check is the separator presence,
    // which `..foo.md` doesn't trip.
    const out = classifyAsWikiPage(path.join(pagesDir, "..foo.md"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: true, slug: "..foo" });
  });

  it("rejects paths outside the workspace entirely", () => {
    const out = classifyAsWikiPage("/etc/passwd", { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  // CodeRabbit review #883: classifier used to accept `<pagesDir>/.md`
  // and return slug = "", which then crashed downstream wikiPagePath()
  // with "refusing unsafe slug". Mirroring isSafeSlug here makes the
  // classifier produce the clean fallback (wiki: false → routes to
  // generic writeFileAtomic) instead of a 500.
  it("rejects bare `.md` filename (slug would be empty)", () => {
    const out = classifyAsWikiPage(path.join(pagesDir, ".md"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects pagesDir itself (no slug)", () => {
    const out = classifyAsWikiPage(pagesDir, { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });
});

// Symlink regression for codex iter-1 #883 — the bug was that
// `resolveSafe()` returns a realpath'd absPath while the un-realpath'd
// `defaultWorkspacePath` is used as the comparison root, so a
// symlinked workspace silently routed wiki writes through the
// generic writer. Pin both behaviours: the buggy mismatch returns
// `{ wiki: false }`, and the fixed call (both sides realpath'd)
// returns `{ wiki: true }`.
describe("wiki-pages/io — classifyAsWikiPage symlink consistency", () => {
  let realRoot: string;
  let linkRoot: string;
  let symlinkSupported = true;

  before(async () => {
    realRoot = await mkdtemp(path.join(tmpdir(), "wiki-pages-real-"));
    // mkdtemp on macOS returns a path under /var/folders that is
    // already a symlink to /private/var/folders. Use realpath to
    // anchor `realRoot` to the actual filesystem location, so the
    // "fixed call" branch below is genuinely realpath-vs-realpath.
    realRoot = await realpath(realRoot);
    linkRoot = path.join(tmpdir(), `wiki-pages-link-${path.basename(realRoot)}`);
    try {
      await symlink(realRoot, linkRoot, "dir");
    } catch (err) {
      // Windows requires admin / Developer Mode for unprivileged
      // symlinks. Skip on environments where that fails so CI
      // (windows-2022) doesn't hard-fail.
      const code = (err as { code?: string }).code;
      if (code === "EPERM" || code === "EACCES") {
        symlinkSupported = false;
      } else {
        throw err;
      }
    }
    if (symlinkSupported) {
      const realPagesDir = path.join(realRoot, WORKSPACE_DIRS.wikiPages);
      await mkdir(realPagesDir, { recursive: true });
    }
  });

  after(async () => {
    if (symlinkSupported) {
      await rm(linkRoot, { force: true });
    }
    await rm(realRoot, { recursive: true, force: true });
  });

  it("buggy mismatch (realpath'd absPath, symlinked root) returns wiki:false", (ctx) => {
    if (!symlinkSupported) {
      ctx.skip("symlink creation not supported in this environment");
      return;
    }
    const realPagePath = path.join(realRoot, WORKSPACE_DIRS.wikiPages, "topic.md");
    // Caller forgot to realpath the workspace root — reproduces the
    // pre-fix behaviour. The classifier returns `wiki: false` and
    // the generic writer would have been used, bypassing the chokepoint.
    const out = classifyAsWikiPage(realPagePath, { workspaceRoot: linkRoot });
    assert.deepEqual(out, { wiki: false });
  });

  it("fixed call (both sides realpath'd) returns wiki:true", (ctx) => {
    if (!symlinkSupported) {
      ctx.skip("symlink creation not supported in this environment");
      return;
    }
    const realPagePath = path.join(realRoot, WORKSPACE_DIRS.wikiPages, "topic.md");
    // Caller correctly passes the realpath'd root. This is what
    // `files.ts` does post-fix (`workspaceReal`).
    const out = classifyAsWikiPage(realPagePath, { workspaceRoot: realRoot });
    assert.deepEqual(out, { wiki: true, slug: "topic" });
  });
});
