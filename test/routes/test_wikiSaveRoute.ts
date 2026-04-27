// Route-level checks for the `POST /api/wiki { action: "save" }`
// handler added in #775. We drive the handler with plain
// Request / Response mocks (same pattern as
// test_canvasImageRoutes.ts) instead of spinning up Express +
// supertest. HOME is redirected to a tmp dir BEFORE the route
// module is imported so `workspacePath` resolves inside the
// sandbox; files created during the tests are cleaned in
// `after()`.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { Request, Response } from "express";

type WikiModule = typeof import("../../server/api/routes/wiki.js");

type Handler = (req: Request, res: Response) => Promise<void> | void;

interface StackFrame {
  route?: {
    path: string;
    stack: Array<{ method: string; handle: Handler }>;
  };
}
interface RouterInternals {
  stack: StackFrame[];
}

function extractRouteHandler(mod: { default: unknown }, routePath: string, method: string): Handler {
  const router = mod.default as unknown as RouterInternals;
  for (const frame of router.stack) {
    if (frame.route?.path !== routePath) continue;
    const layer = frame.route.stack.find((stackLayer) => stackLayer.method === method);
    if (layer) return layer.handle;
  }
  throw new Error(`route ${method.toUpperCase()} ${routePath} not registered`);
}

interface ResBody {
  data?: { content?: string; pageExists?: boolean };
  error?: string;
}

function mockRes() {
  const state: { status: number; body: ResBody | undefined } = {
    status: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: ResBody) {
      state.body = payload;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

function req(body: unknown): Request {
  return { body } as unknown as Request;
}

let tmpRoot: string;
let pagesDir: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let postWikiHandler: Handler;

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-wiki-save-route-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;

  const { workspacePath: workspacePth } = await import("../../server/workspace/workspace.js");
  const { WORKSPACE_DIRS } = await import("../../server/workspace/paths.js");
  pagesDir = path.join(workspacePth, WORKSPACE_DIRS.wikiPages);
  mkdirSync(pagesDir, { recursive: true });

  const wikiMod: WikiModule = await import("../../server/api/routes/wiki.js");
  postWikiHandler = extractRouteHandler(wikiMod, "/api/wiki", "post");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/wiki — action: save", () => {
  // Reset the module-level page-index cache before every test.
  // The cache invalidates on `pagesDir` mtime change, but Windows
  // NTFS has ~10–15 ms mtime granularity — two file writes within
  // that window leave the cache pinned to the first state, so a
  // page created in test N can be invisible to test N+1's
  // resolvePagePath. Linux/macOS happen to land on different ms
  // each time so the bug only surfaces on Windows CI runners.
  // (Pre-existing from #775 / PR #795; surfaced on PR #801.)
  beforeEach(async () => {
    const { __resetPageIndexCache } = await import("../../server/api/routes/wiki/pageIndex.js");
    __resetPageIndexCache();
  });

  it("overwrites an existing page atomically (with auto-stamped frontmatter)", async () => {
    // Post-#895-PR-B: even body-only saves get a frontmatter
    // envelope stamped with created / updated / editor. The body
    // content survives verbatim; the wrapper is the new shape.
    const slug = "test-page";
    const filePath = path.join(pagesDir, `${slug}.md`);
    await writeFile(filePath, "# Original\n\n- [ ] task\n", "utf-8");

    const newContent = "# Original\n\n- [x] task\n";
    const { state, res } = mockRes();
    await postWikiHandler(req({ action: "save", pageName: slug, content: newContent }), res);

    assert.equal(state.status, 200);
    const onDisk = await readFile(filePath, "utf-8");
    // Body must be preserved verbatim, but the file now carries a
    // frontmatter envelope with auto-stamped fields.
    assert.match(onDisk, /\n- \[x\] task\n$/);
    assert.match(onDisk, /^---\n/);
    assert.match(onDisk, /editor: user/);
    // Response should reflect the on-disk canonical content.
    assert.equal(state.body?.data?.content, onDisk);
    assert.equal(state.body?.data?.pageExists, true);
  });

  it("preserves frontmatter when the body has been toggled", async () => {
    // The route now stamps `created` / `updated` / `editor` on save
    // (#895 PR B). Existing user-supplied keys must still survive
    // verbatim. Assert the stable fields explicitly rather than
    // comparing the whole file byte-for-byte.
    const slug = "with-frontmatter";
    const filePath = path.join(pagesDir, `${slug}.md`);
    const original = "---\ntitle: Foo\ntags: [a, b]\n---\n\n- [ ] task one\n- [ ] task two\n";
    await writeFile(filePath, original, "utf-8");

    const updated = "---\ntitle: Foo\ntags: [a, b]\n---\n\n- [x] task one\n- [ ] task two\n";
    const { state, res } = mockRes();
    await postWikiHandler(req({ action: "save", pageName: slug, content: updated }), res);

    assert.equal(state.status, 200);
    const onDisk = await readFile(filePath, "utf-8");
    assert.match(onDisk, /^---\n/, "frontmatter delimiters should round-trip");
    assert.match(onDisk, /title: Foo/, "user-supplied title preserved");
    assert.match(onDisk, /\n- \[x\] task one\n- \[ \] task two\n$/, "body toggled correctly");
    // `tags` round-trips as either flow-style `[a, b]` or block list.
    // Either is fine — assert both entries appear somewhere in the
    // header rather than pinning a specific YAML serialisation.
    const headerEnd = onDisk.indexOf("\n---\n", 4);
    const header = onDisk.slice(0, headerEnd);
    assert.match(header, /\ba\b/);
    assert.match(header, /\bb\b/);
  });

  it("rejects a request with no pageName", async () => {
    const { state, res } = mockRes();
    await postWikiHandler(req({ action: "save", content: "anything" }), res);
    assert.equal(state.status, 400);
    assert.match(state.body?.error ?? "", /pagename/i);
  });

  it("rejects a request with no content field", async () => {
    const { state, res } = mockRes();
    await postWikiHandler(req({ action: "save", pageName: "test-page" }), res);
    assert.equal(state.status, 400);
    assert.match(state.body?.error ?? "", /content/i);
  });

  it("rejects a request with non-string content (e.g. accidental array)", async () => {
    const { state, res } = mockRes();
    await postWikiHandler(req({ action: "save", pageName: "test-page", content: ["foo"] }), res);
    assert.equal(state.status, 400);
    assert.match(state.body?.error ?? "", /content/i);
  });

  it("returns 404 when the page doesn't exist (no creation via save)", async () => {
    const { state, res } = mockRes();
    await postWikiHandler(req({ action: "save", pageName: "nonexistent-page", content: "hello" }), res);
    assert.equal(state.status, 404);
    assert.match(state.body?.error ?? "", /not found/i);
  });

  it("traversal-shaped pageName is sanitised by slugify and refused as not-found", async () => {
    const { state, res } = mockRes();
    // wikiSlugify strips slashes / dots; the resulting empty / sanitised
    // slug doesn't match any real page so resolvePagePath returns null.
    await postWikiHandler(req({ action: "save", pageName: "../../etc/passwd", content: "x" }), res);
    assert.equal(state.status, 404);
  });
});
