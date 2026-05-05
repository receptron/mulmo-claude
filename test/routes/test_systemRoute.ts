import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import systemRouter from "../../server/api/routes/system.ts";
import { env } from "../../server/system/env.ts";

// Lightweight handler-extraction (same pattern as test_configRoute).
// The route under test is a thin reader that returns
// `{ devMode: env.devMode }` — we only need to confirm the response
// shape and that the value tracks the env snapshot. The flag itself
// is provided by `server/system/env.ts`, which is exercised by
// existing env-coverage tests.

type Handler = (req: Request, res: Response) => void;

interface StackFrame {
  route?: {
    path: string;
    stack: { method: string; handle: Handler }[];
  };
}

interface RouterInternals {
  stack: StackFrame[];
}

function extractHandler(routePath: string): Handler {
  const router = systemRouter as unknown as RouterInternals;
  for (const frame of router.stack) {
    if (frame.route?.path !== routePath) continue;
    const layer = frame.route.stack.find((stackLayer) => stackLayer.method === "get");
    if (layer) return layer.handle;
  }
  throw new Error(`route GET ${routePath} not registered`);
}

function buildResMock(): { json: (body: unknown) => void; captured: { body: unknown } } {
  const captured: { body: unknown } = { body: undefined };
  return {
    captured,
    json(body: unknown) {
      captured.body = body;
    },
  };
}

describe("GET /api/system/config", () => {
  it("returns { devMode } reflecting env.devMode", () => {
    const handler = extractHandler("/api/system/config");
    const res = buildResMock();
    handler({} as Request, res as unknown as Response);
    assert.deepEqual(res.captured.body, { devMode: env.devMode });
  });

  it("response is JSON-serializable with a single boolean field", () => {
    const handler = extractHandler("/api/system/config");
    const res = buildResMock();
    handler({} as Request, res as unknown as Response);
    const body = res.captured.body as Record<string, unknown>;
    assert.equal(typeof body.devMode, "boolean");
    assert.deepEqual(Object.keys(body), ["devMode"]);
  });
});
