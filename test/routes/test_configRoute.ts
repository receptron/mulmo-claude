// Route-level checks for /api/config.
//
// The route logic itself is a thin wrapper around server/system/config.ts —
// load/save/validate. These tests cover:
//   - GET returns the current settings wrapped in { settings }
//   - PUT /config/settings validates shape + persists + returns the
//     re-read state (not the incoming payload, to catch write/read
//     drift)
//   - PUT rejects malformed bodies with HTTP 400
//
// Heavier integration — round-trips across the real Express stack
// including CSRF — is covered by e2e/tests/settings.spec.ts.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import type { Request, Response } from "express";

type ConfigModule = typeof import("../../server/system/config.js");
type RouteModule = typeof import("../../server/api/routes/config.js");

let tmpRoot: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let configMod: ConfigModule;
let routeMod: RouteModule;

// Extract the two handlers from the Router so we can invoke them
// with plain req/res mocks (no supertest dependency).
type Handler = (req: Request, res: Response) => void;
let getHandler: Handler;
let putSettingsHandler: Handler;
let putConfigHandler: Handler;

interface StackFrame {
  route?: {
    path: string;
    stack: Array<{ method: string; handle: Handler }>;
  };
}

interface RouterInternals {
  stack: StackFrame[];
}

function extractRouteHandler(mod: RouteModule, routePath: string, method: "get" | "put"): Handler {
  const router = mod.default as unknown as RouterInternals;
  // Each router.get/put() registers its own stack frame, so find the
  // frame matching BOTH path and method rather than the first path hit.
  for (const frame of router.stack) {
    if (frame.route?.path !== routePath) continue;
    const layer = frame.route.stack.find((stackLayer) => stackLayer.method === method);
    if (layer) return layer.handle;
  }
  throw new Error(`route ${method.toUpperCase()} ${routePath} not registered`);
}

function mockRes() {
  const state: {
    status: number;
    body: unknown;
    ended: boolean;
  } = { status: 200, body: undefined, ended: false };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      state.ended = true;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

before(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mulmo-config-route-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  // os.homedir() uses HOME on POSIX and USERPROFILE on Windows.
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  fs.mkdirSync(path.join(tmpRoot, "mulmoclaude"), { recursive: true });
  configMod = await import("../../server/system/config.js");
  routeMod = await import("../../server/api/routes/config.js");
  getHandler = extractRouteHandler(routeMod, "/api/config", "get");
  putSettingsHandler = extractRouteHandler(routeMod, "/api/config/settings", "put");
  putConfigHandler = extractRouteHandler(routeMod, "/api/config", "put");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /config", () => {
  beforeEach(() => {
    fs.rmSync(configMod.configsDir(), { recursive: true, force: true });
  });

  it("returns defaults when nothing is on disk", () => {
    const { state, res } = mockRes();
    getHandler({} as Request, res);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, {
      settings: { extraAllowedTools: [] },
      mcp: { servers: [] },
    });
  });

  it("returns the persisted settings", () => {
    configMod.saveSettings({
      extraAllowedTools: ["mcp__claude_ai_Gmail"],
    });
    const { state, res } = mockRes();
    getHandler({} as Request, res);
    assert.deepEqual(state.body, {
      settings: { extraAllowedTools: ["mcp__claude_ai_Gmail"] },
      mcp: { servers: [] },
    });
  });
});

describe("PUT /config/settings", () => {
  beforeEach(() => {
    fs.rmSync(configMod.configsDir(), { recursive: true, force: true });
  });

  it("persists a well-formed payload and echoes the re-read state", () => {
    const body = { extraAllowedTools: ["alpha", "beta"] };
    const { state, res } = mockRes();
    putSettingsHandler({ body } as Request, res);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { settings: body, mcp: { servers: [] } });
    assert.deepEqual(configMod.loadSettings(), body);
  });

  it("rejects invalid shape with 400", () => {
    const { state, res } = mockRes();
    putSettingsHandler({ body: { extraAllowedTools: "not-an-array" } } as Request, res);
    assert.equal(state.status, 400);
    const body = state.body as { error: string };
    assert.match(body.error, /Invalid/);
  });

  it("rejects null body with 400", () => {
    const { state, res } = mockRes();
    putSettingsHandler({ body: null } as Request, res);
    assert.equal(state.status, 400);
  });

  it("rejects arrays containing non-strings", () => {
    const { state, res } = mockRes();
    putSettingsHandler({ body: { extraAllowedTools: ["ok", 42] } } as Request, res);
    assert.equal(state.status, 400);
  });

  it("overwrites a prior save", () => {
    configMod.saveSettings({ extraAllowedTools: ["old"] });
    const { state, res } = mockRes();
    putSettingsHandler({ body: { extraAllowedTools: ["new"] } } as Request, res);
    assert.equal(state.status, 200);
    assert.deepEqual(configMod.loadSettings().extraAllowedTools, ["new"]);
  });
});

describe("PUT /config (atomic)", () => {
  beforeEach(() => {
    fs.rmSync(configMod.configsDir(), { recursive: true, force: true });
  });

  it("persists settings and mcp together in a single call", () => {
    const body = {
      settings: { extraAllowedTools: ["alpha"] },
      mcp: {
        servers: [
          {
            id: "gh",
            spec: { type: "http", url: "https://example.com", enabled: true },
          },
        ],
      },
    };
    const { state, res } = mockRes();
    putConfigHandler({ body } as Request, res);
    assert.equal(state.status, 200);
    assert.deepEqual((state.body as { settings: { extraAllowedTools: string[] } }).settings.extraAllowedTools, ["alpha"]);
    assert.deepEqual(configMod.loadSettings().extraAllowedTools, ["alpha"]);
  });

  it("rejects when settings shape is invalid", () => {
    const body = {
      settings: { extraAllowedTools: "not-an-array" },
      mcp: { servers: [] },
    };
    const { state, res } = mockRes();
    putConfigHandler({ body } as Request, res);
    assert.equal(state.status, 400);
  });

  it("rejects when mcp shape is invalid", () => {
    const body = {
      settings: { extraAllowedTools: [] },
      mcp: { servers: "nope" },
    };
    const { state, res } = mockRes();
    putConfigHandler({ body } as Request, res);
    assert.equal(state.status, 400);
  });

  it("does not persist settings when mcp payload fails validation", () => {
    configMod.saveSettings({ extraAllowedTools: ["before"] });
    const body = {
      settings: { extraAllowedTools: ["after"] },
      // Missing required fields → fromMcpEntries throws
      mcp: { servers: [{ id: "x", spec: { type: "bogus" } }] },
    };
    const { state, res } = mockRes();
    putConfigHandler({ body } as Request, res);
    assert.equal(state.status, 400);
    // Validation happens before any write — previous state unchanged
    assert.deepEqual(configMod.loadSettings().extraAllowedTools, ["before"]);
  });
});
