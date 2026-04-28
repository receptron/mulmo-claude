// Route-level tests for `POST /api/wiki/internal/snapshot` —
// hit by the LLM-write hook script after a Claude CLI Write/Edit
// touches a wiki page (#763 PR 2 prereq). Same handler-extract
// pattern as test_wikiSaveRoute.ts so we exercise the route
// without spinning up an Express server / supertest.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { Request, Response } from "express";

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
  slug?: string;
  ok?: boolean;
  error?: string;
}

function mockRes() {
  const state: { status: number; body: ResBody | undefined } = { status: 200, body: undefined };
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

function makeReq(body: unknown): Request {
  return { body } as unknown as Request;
}

let tmpRoot: string;
let pagesDir: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let snapshotHandler: Handler;
let listSnapshots: typeof import("../../server/workspace/wiki-pages/snapshot.js").listSnapshots;

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "wiki-internal-snap-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;

  const { workspacePath: workspacePth } = await import("../../server/workspace/workspace.js");
  const { WORKSPACE_DIRS } = await import("../../server/workspace/paths.js");
  pagesDir = path.join(workspacePth, WORKSPACE_DIRS.wikiPages);
  mkdirSync(pagesDir, { recursive: true });

  const historyMod = await import("../../server/api/routes/wiki/history.js");
  snapshotHandler = extractRouteHandler(historyMod, "/internal/snapshot", "post");
  ({ listSnapshots } = await import("../../server/workspace/wiki-pages/snapshot.js"));
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("POST /api/wiki/internal/snapshot", () => {
  it("returns 400 when slug is missing", async () => {
    const { state, res } = mockRes();
    await snapshotHandler(makeReq({}), res);
    assert.equal(state.status, 400);
  });

  it("returns 400 when slug contains a path separator", async () => {
    const { state, res } = mockRes();
    await snapshotHandler(makeReq({ slug: "../etc/passwd" }), res);
    assert.equal(state.status, 400);
  });

  it("returns 400 for the literal `..` slug", async () => {
    const { state, res } = mockRes();
    await snapshotHandler(makeReq({ slug: ".." }), res);
    assert.equal(state.status, 400);
  });

  it("returns 404 when the slug's file doesn't exist on disk", async () => {
    const { state, res } = mockRes();
    await snapshotHandler(makeReq({ slug: "missing" }), res);
    assert.equal(state.status, 404);
  });

  it("records a snapshot tagged editor=llm for a valid slug", async () => {
    const slug = "valid-llm-write";
    const filePath = path.join(pagesDir, `${slug}.md`);
    await writeFile(filePath, "---\ntitle: x\n---\n\nllm-written body\n", "utf-8");

    const { state, res } = mockRes();
    await snapshotHandler(makeReq({ slug }), res);
    assert.equal(state.status, 200);
    assert.equal(state.body?.ok, true);
    assert.equal(state.body?.slug, slug);

    const snapshots = await listSnapshots(slug);
    assert.equal(snapshots.length, 1, "endpoint should have written exactly one snapshot");
    assert.equal(snapshots[0].editor, "llm", "hook always tags as llm — user-driven writes go through writeWikiPage");
    // The hook never supplies `reason` (the LLM has no natural source
    // for one) — the field is absent from this code path.
    assert.equal(snapshots[0].reason, undefined);
  });

  it("propagates sessionId when the hook supplies one", async () => {
    const slug = "with-session";
    const filePath = path.join(pagesDir, `${slug}.md`);
    await writeFile(filePath, "body\n", "utf-8");

    const { state, res } = mockRes();
    await snapshotHandler(makeReq({ slug, sessionId: "chat-abc-123" }), res);
    assert.equal(state.status, 200);

    const snapshots = await listSnapshots(slug);
    assert.equal(snapshots[0].sessionId, "chat-abc-123");
  });
});
