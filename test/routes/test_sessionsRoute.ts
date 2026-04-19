// Route-level checks for GET /api/sessions — end-to-end behaviour
// of the cursor-aware incremental fetch added for issue #205.
//
// We drive the handler with plain Request / Response mocks so we
// don't pay for an Express + supertest harness. The handler itself
// stats real files in a temp workspace, so these tests double as a
// regression check on the mtime-based `updatedAt` wiring.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { mkdtemp, rm, writeFile, utimes } from "fs/promises";
import os from "os";
import path from "path";
import type { Request, Response } from "express";
import { encodeCursor } from "../../server/api/routes/sessionsCursor.js";

type RouteModule = typeof import("../../server/api/routes/sessions.js");

interface SessionSummary {
  id: string;
  roleId: string;
  startedAt: string;
  updatedAt: string;
  preview: string;
}

interface SessionsResponse {
  sessions: SessionSummary[];
  cursor: string;
  deletedIds: string[];
}

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

function extractRouteHandler(
  mod: RouteModule,
  routePath: string,
  method: string,
): Handler {
  const router = mod.default as unknown as RouterInternals;
  for (const frame of router.stack) {
    if (frame.route?.path !== routePath) continue;
    const layer = frame.route.stack.find((s) => s.method === method);
    if (layer) return layer.handle;
  }
  throw new Error(`route ${method.toUpperCase()} ${routePath} not registered`);
}

function mockRes() {
  const state: { status: number; body: SessionsResponse | undefined } = {
    status: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: SessionsResponse) {
      state.body = payload;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

// Base timestamps comfortably within the 90-day window so the
// SESSIONS_LIST_WINDOW_DAYS cutoff never hides them during tests.
// All per-test timestamps are offsets from this base.
// Rounded to whole seconds so the utimes(secs) → stat(mtimeMs)
// roundtrip doesn't lose sub-ms precision on CI filesystems.
const BASE_MS = Math.floor((Date.now() - 10 * 86_400_000) / 1000) * 1000;

let tmpRoot: string;
let chatDir: string;
// The manifest lives under a DIFFERENT tree from the session files —
// `chatDirFor(workspaceRoot)` = `<workspace>/chat/index/manifest.json`
// while WORKSPACE_PATHS.chat may be `<workspace>/conversations/chat/`.
let manifestDir: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let getHandler: Handler;
let markReadHandler: Handler;

async function writeSession(
  id: string,
  opts: {
    roleId?: string;
    mtimeMs: number;
    indexedAtMs?: number;
    firstUserMessage?: string;
  },
): Promise<void> {
  // Minimal session files: a .json meta + an empty-ish .jsonl.
  const meta = {
    roleId: opts.roleId ?? "general",
    startedAt: new Date(opts.mtimeMs).toISOString(),
    firstUserMessage: opts.firstUserMessage ?? `msg for ${id}`,
  };
  await writeFile(path.join(chatDir, `${id}.json`), JSON.stringify(meta));
  await writeFile(path.join(chatDir, `${id}.jsonl`), "");
  // Set both atime and mtime so the handler's stat.mtimeMs reads
  // what the test intends.
  const secs = opts.mtimeMs / 1000;
  await utimes(path.join(chatDir, `${id}.jsonl`), secs, secs);

  if (opts.indexedAtMs !== undefined) {
    const manifestPath = path.join(manifestDir, "manifest.json");
    let entries: unknown[] = [];
    try {
      entries =
        JSON.parse(fs.readFileSync(manifestPath, "utf-8")).entries ?? [];
    } catch {
      /* first write */
    }
    entries.push({
      id,
      roleId: meta.roleId,
      startedAt: meta.startedAt,
      indexedAt: new Date(opts.indexedAtMs).toISOString(),
      title: `AI title ${id}`,
      summary: `AI summary ${id}`,
      keywords: ["k1"],
    });
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify({ version: 1, entries }));
  }
}

async function resetChatDir(): Promise<void> {
  await rm(chatDir, { recursive: true, force: true });
  await rm(manifestDir, { recursive: true, force: true });
  fs.mkdirSync(chatDir, { recursive: true });
  fs.mkdirSync(manifestDir, { recursive: true });
}

before(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mulmo-sessions-route-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  // The workspace path resolves once at module load from os.homedir(),
  // so we have to steer it BEFORE importing the route module. This
  // mirrors the setup in test_configRoute.ts.
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  // Use the real dir names from the workspace/paths and chat-index
  // modules — they may differ (e.g. `conversations/chat` for session
  // files, `chat/index` for the manifest after #284).
  const { WORKSPACE_PATHS } = await import("../../server/workspace/paths.js");
  const { indexDirFor } =
    await import("../../server/workspace/chat-index/paths.js");
  const { workspacePath: wp } =
    await import("../../server/workspace/workspace.js");
  chatDir = WORKSPACE_PATHS.chat;
  manifestDir = indexDirFor(wp);
  fs.mkdirSync(chatDir, { recursive: true });
  fs.mkdirSync(manifestDir, { recursive: true });
  const routeMod = await import("../../server/api/routes/sessions.js");
  getHandler = extractRouteHandler(routeMod, "/api/sessions", "get");
  markReadHandler = extractRouteHandler(
    routeMod,
    "/api/sessions/:id/mark-read",
    "post",
  );
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetChatDir();
});

describe("GET /api/sessions — full fetch (no ?since=)", () => {
  it("returns every visible session plus an envelope with cursor + empty deletedIds", async () => {
    await writeSession("s1", { mtimeMs: BASE_MS });
    await writeSession("s2", { mtimeMs: BASE_MS + 100_000_000 });

    const { state, res } = mockRes();
    await getHandler({ query: {} } as unknown as Request, res);

    assert.equal(state.status, 200);
    const body = state.body!;
    assert.equal(body.sessions.length, 2);
    assert.deepEqual(body.deletedIds, [], "deletedIds is always [] today");
    assert.ok(
      body.cursor.startsWith("v1:"),
      `opaque cursor, got: ${body.cursor}`,
    );
    assert.equal(body.cursor, encodeCursor(BASE_MS + 100_000_000));
  });

  it("sorts newest updatedAt first", async () => {
    await writeSession("older", { mtimeMs: BASE_MS });
    await writeSession("newer", { mtimeMs: BASE_MS + 500_000_000 });

    const { state, res } = mockRes();
    await getHandler({ query: {} } as unknown as Request, res);
    const ids = state.body!.sessions.map((s) => s.id);
    assert.deepEqual(ids, ["newer", "older"]);
  });
});

describe("GET /api/sessions?since=<cursor> — incremental fetch", () => {
  it("omits sessions whose changeMs <= cursor", async () => {
    await writeSession("old", { mtimeMs: BASE_MS });
    await writeSession("new", { mtimeMs: BASE_MS + 200_000_000 });

    const { state, res } = mockRes();
    await getHandler(
      {
        query: { since: encodeCursor(BASE_MS + 100_000_000) },
      } as unknown as Request,
      res,
    );
    const ids = state.body!.sessions.map((s) => s.id);
    assert.deepEqual(ids, ["new"]);
  });

  it("includes a session whose chat-index indexedAt bumped past cursor (mtime alone would miss it)", async () => {
    await writeSession("summarised", {
      mtimeMs: BASE_MS,
      indexedAtMs: BASE_MS + 500_000_000,
    });

    const { state, res } = mockRes();
    await getHandler(
      {
        query: { since: encodeCursor(BASE_MS + 100_000_000) },
      } as unknown as Request,
      res,
    );
    const ids = state.body!.sessions.map((s) => s.id);
    assert.deepEqual(ids, ["summarised"]);
    // The returned cursor must advance to the indexedAt time, not
    // just the mtime, so the next call won't re-fetch this row.
    assert.equal(state.body!.cursor, encodeCursor(BASE_MS + 500_000_000));
  });

  it("returns an empty diff when nothing has changed since cursor", async () => {
    await writeSession("s", { mtimeMs: BASE_MS });

    const { state, res } = mockRes();
    await getHandler(
      {
        query: { since: encodeCursor(BASE_MS + 100_000_000) },
      } as unknown as Request,
      res,
    );
    assert.deepEqual(state.body!.sessions, []);
    // Cursor is echoed to the server's view of the max change —
    // same or higher than the client's — so subsequent idempotent
    // calls keep getting empty diffs.
    assert.equal(state.body!.cursor, encodeCursor(BASE_MS));
  });

  it("falls back to a full resend when the cursor is malformed", async () => {
    await writeSession("a", { mtimeMs: BASE_MS });
    await writeSession("b", { mtimeMs: BASE_MS + 100_000_000 });

    const { state, res } = mockRes();
    await getHandler(
      { query: { since: "not-a-cursor" } } as unknown as Request,
      res,
    );
    assert.equal(state.body!.sessions.length, 2);
  });

  it("round-trips: feed the returned cursor back in → empty diff", async () => {
    await writeSession("a", { mtimeMs: BASE_MS });

    const first = mockRes();
    await getHandler({ query: {} } as unknown as Request, first.res);
    const cursor = first.state.body!.cursor;

    const second = mockRes();
    await getHandler(
      { query: { since: cursor } } as unknown as Request,
      second.res,
    );
    assert.deepEqual(second.state.body!.sessions, []);
  });
});

// ── POST /api/sessions/:id/mark-read ──────────────────────────

function mockMarkReadRes() {
  const state: { status: number; body: { ok: boolean } | undefined } = {
    status: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: { ok: boolean }) {
      state.body = payload;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

describe("POST /api/sessions/:id/mark-read", () => {
  it("returns { ok: true } for a session that exists on disk", async () => {
    await writeSession("s1", { mtimeMs: BASE_MS });
    const { state, res } = mockMarkReadRes();
    await markReadHandler({ params: { id: "s1" } } as unknown as Request, res);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { ok: true });
  });

  it("succeeds even when no session file exists (graceful no-op)", async () => {
    const { state, res } = mockMarkReadRes();
    await markReadHandler(
      { params: { id: "nonexistent" } } as unknown as Request,
      res,
    );
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { ok: true });
  });

  it("persists hasUnread=false to the meta .json file", async () => {
    // Write a meta with hasUnread=true
    const metaPath = path.join(chatDir, "s1.json");
    await writeFile(
      metaPath,
      JSON.stringify({ roleId: "general", hasUnread: true }),
    );
    await writeFile(path.join(chatDir, "s1.jsonl"), "");

    const { res } = mockMarkReadRes();
    await markReadHandler({ params: { id: "s1" } } as unknown as Request, res);

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    assert.equal(meta.hasUnread, false);
  });
});
