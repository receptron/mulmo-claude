// Coverage for the HTML-artifact splice path that powers iframe
// self-repair (#1025). The middleware in `server/index.ts` mounts
// this helper against `/artifacts/html`; we exercise the helper
// directly so we don't need a full Express + supertest harness.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath as fsRealpath, rm, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { readAndInjectHtmlArtifact } from "../../server/utils/html/htmlArtifactSplicer.js";

let workspaceRoot: string;
let htmlsRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmo-iframe-repair-"));
  await mkdir(path.join(workspaceRoot, "html"), { recursive: true });
  // `resolveWithinRoot` expects a realpath; on macOS /tmp is a
  // symlink to /private/tmp, so resolve before use.
  htmlsRoot = await fsRealpath(path.join(workspaceRoot, "html"));
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("readAndInjectHtmlArtifact", () => {
  it("splices the script before </body> for a well-formed page", async () => {
    const file = path.join(htmlsRoot, "ok.html");
    await writeFile(file, "<html><body><p>hello</p></body></html>", "utf8");
    const out = await readAndInjectHtmlArtifact(htmlsRoot, "ok.html");
    assert.ok(out !== null);
    assert.match(out, /<\/p><script>[\s\S]+<\/script><\/body>/);
  });

  it("appends the script when the document has no </body> close", async () => {
    const file = path.join(htmlsRoot, "fragment.html");
    await writeFile(file, "<p>just a fragment</p>", "utf8");
    const out = await readAndInjectHtmlArtifact(htmlsRoot, "fragment.html");
    assert.ok(out !== null);
    assert.ok(out.startsWith("<p>just a fragment</p>"));
    assert.ok(out.includes("<script>"));
    assert.ok(out.endsWith("</script>"));
  });

  it("preserves all original characters around the splice point", async () => {
    const file = path.join(htmlsRoot, "preserve.html");
    const html = "<html><body><div>content</div></body></html>";
    await writeFile(file, html, "utf8");
    const out = await readAndInjectHtmlArtifact(htmlsRoot, "preserve.html");
    assert.ok(out !== null);
    assert.equal(out.replace(/<script>[\s\S]+?<\/script>/, ""), html);
  });

  it("returns null when the path escapes htmlsRoot via traversal", async () => {
    const out = await readAndInjectHtmlArtifact(htmlsRoot, "../escape.html");
    assert.equal(out, null);
  });

  it("returns null when the file does not exist", async () => {
    const out = await readAndInjectHtmlArtifact(htmlsRoot, "missing.html");
    assert.equal(out, null);
  });

  it("returns null for an absolute path (resolveWithinRoot rejects)", async () => {
    const out = await readAndInjectHtmlArtifact(htmlsRoot, "/etc/passwd");
    assert.equal(out, null);
  });

  it("works on files in nested subdirectories under htmlsRoot", async () => {
    const subDir = path.join(htmlsRoot, "2026", "04");
    await mkdir(subDir, { recursive: true });
    await writeFile(path.join(subDir, "page.html"), "<body>x</body>", "utf8");
    const out = await readAndInjectHtmlArtifact(htmlsRoot, "2026/04/page.html");
    assert.ok(out !== null);
    assert.match(out, /x<script>[\s\S]+<\/script><\/body>/);
  });

  it("would happily serve a dotfile if asked — the dotfile-deny policy lives in the middleware, not here", async () => {
    // Documents the contract split: `readAndInjectHtmlArtifact` is
    // "pure read + splice". Dotfile rejection is enforced upstream
    // in `server/index.ts` for parity with `express.static`'s
    // `dotfiles: "deny"`. If you call this helper directly with a
    // dotfile name, it WILL serve it.
    await writeFile(path.join(htmlsRoot, ".hidden.html"), "<body>secret</body>", "utf8");
    const out = await readAndInjectHtmlArtifact(htmlsRoot, ".hidden.html");
    assert.ok(out !== null);
    assert.match(out, /secret<script>/);
  });
});
