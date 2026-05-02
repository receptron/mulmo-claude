// Regression tests for the asset-route anchor on
// `/api/plugins/runtime/:pkg/:version/{*splat}` (#1043 C-2).
//
// The route is bearer-auth-exempt so the browser can dynamic-import
// plugin assets, which means it has to defend against percent-
// encoded `../` arriving in `pkg` / `version`. The current model is
// registry-membership: only (pkg, version) pairs that are present in
// the in-process runtime registry resolve to a real path, and those
// pairs are written by trusted code (preset list / workspace ledger).
// Anything else is a 404.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import runtimePluginRouter, { resolvePluginRoot } from "../../../server/api/routes/runtime-plugin.ts";
import { registerRuntimePlugins, _resetRuntimeRegistryForTest } from "../../../server/plugins/runtime-registry.ts";
import type { RuntimePlugin } from "../../../server/plugins/runtime-loader.ts";

let fixtureDir: string;
let outsideDir: string;

beforeEach(() => {
  _resetRuntimeRegistryForTest();
  fixtureDir = mkdtempSync(path.join(tmpdir(), "mulmo-asset-anchor-fixture-"));
  // A directory the test plants OUTSIDE the registry's known roots.
  // The route must never serve from here regardless of URL shape.
  outsideDir = mkdtempSync(path.join(tmpdir(), "mulmo-asset-anchor-outside-"));
  writeFileSync(path.join(outsideDir, "secret.txt"), "should-not-leak");
  mkdirSync(path.join(fixtureDir, "dist"), { recursive: true });
  writeFileSync(path.join(fixtureDir, "dist", "ok.js"), "// ok");
});

afterEach(() => {
  _resetRuntimeRegistryForTest();
  try {
    rmSync(fixtureDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  try {
    rmSync(outsideDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

const fakePlugin = (name: string, version: string, cachePath: string): RuntimePlugin => ({
  name,
  version,
  cachePath,
  definition: {
    type: "function",
    name: `tool_${name}`,
    description: "fixture",
    parameters: { type: "object", properties: {}, required: [] },
  },
  execute: null,
});

describe("resolvePluginRoot — registry membership", () => {
  it("returns the cachePath realpath for a registered (pkg, version)", () => {
    registerRuntimePlugins(new Set(), [fakePlugin("@fixture/anchor", "1.0.0", fixtureDir)]);
    const result = resolvePluginRoot("@fixture/anchor", "1.0.0");
    assert.ok(result, "expected a realpath for a registered plugin");
    // realpath may resolve OS-level symlinks (e.g. macOS /var → /private/var),
    // so just assert the returned path ends in the fixture's basename.
    assert.match(result ?? "", new RegExp(`${path.basename(fixtureDir)}$`));
  });

  it("returns null when the (pkg, version) pair is not registered", () => {
    registerRuntimePlugins(new Set(), [fakePlugin("@fixture/anchor", "1.0.0", fixtureDir)]);
    assert.equal(resolvePluginRoot("@fixture/anchor", "9.9.9"), null, "wrong version → 404");
    assert.equal(resolvePluginRoot("@other/never-installed", "1.0.0"), null, "unknown package → 404");
  });

  it("returns null when registered cachePath does not exist on disk", () => {
    const ghost = path.join(fixtureDir, "vanished");
    registerRuntimePlugins(new Set(), [fakePlugin("@fixture/ghost", "1.0.0", ghost)]);
    assert.equal(resolvePluginRoot("@fixture/ghost", "1.0.0"), null);
  });

  it("encoded `../` in pkg cannot match a registered name", () => {
    // Even with a directory traversal that points at `outsideDir` on
    // disk, the registry lookup uses the literal name string. The
    // pkg `..` is not a registered name, so 404.
    registerRuntimePlugins(new Set(), [fakePlugin("@fixture/anchor", "1.0.0", fixtureDir)]);
    assert.equal(resolvePluginRoot("../../../../etc", "passwd"), null);
    assert.equal(resolvePluginRoot("..", "1.0.0"), null);
    assert.equal(resolvePluginRoot("", "1.0.0"), null);
  });

  it("encoded `../` in version cannot match a registered version", () => {
    registerRuntimePlugins(new Set(), [fakePlugin("@fixture/anchor", "1.0.0", fixtureDir)]);
    assert.equal(resolvePluginRoot("@fixture/anchor", "../../tmp"), null);
    assert.equal(resolvePluginRoot("@fixture/anchor", ""), null);
  });

  it("an attacker registering a cachePath outside the workspace can only serve from THAT path", () => {
    // The trust model: registry membership is the boundary. If a
    // server-side caller (preset list, ledger) registers a cachePath
    // pointing outside the workspace, that's by design (presets live
    // in node_modules). The route's job is to ensure NO OTHER path
    // is reachable — verified by the negative cases above.
    registerRuntimePlugins(new Set(), [fakePlugin("@fixture/outside", "1.0.0", outsideDir)]);
    const result = resolvePluginRoot("@fixture/outside", "1.0.0");
    assert.ok(result, "registered cachePath resolves regardless of where on disk it points");
    // But a different (pkg, version) still doesn't reach it.
    assert.equal(resolvePluginRoot(`../${path.basename(outsideDir)}`, "1.0.0"), null);
  });
});

// gui-chat-protocol's `ToolPluginCore.execute` signature is
// `(context: ToolContext, args) => Promise<ToolResult>`. The dispatch
// route MUST call it with both args in that order — when callers
// passed only the args object, plugins like @gui-chat-plugin/weather
// crashed inside their handler with "Cannot destructure property
// 'areaCode' of '<arg>' as it is undefined" because the destructured
// arg landed in the unused first slot and the real args slot was
// undefined.
describe("POST /api/plugins/runtime/:pkg/dispatch — call signature", () => {
  it("invokes plugin.execute with (context, args) in order", async () => {
    const calls: { context: unknown; args: unknown }[] = [];
    const spyPlugin: RuntimePlugin = {
      name: "@fixture/spy",
      version: "1.0.0",
      cachePath: fixtureDir,
      definition: {
        type: "function",
        name: "tool_spy",
        description: "fixture",
        parameters: { type: "object", properties: {}, required: [] },
      },
      execute: async (context: unknown, args: unknown) => {
        calls.push({ context, args });
        return { ok: true };
      },
    };
    registerRuntimePlugins(new Set(), [spyPlugin]);

    const app = express();
    app.disable("x-powered-by");
    app.use(express.json());
    app.use(runtimePluginRouter);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/plugins/runtime/${encodeURIComponent("@fixture/spy")}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaCode: "130000" }),
      });
      assert.equal(res.status, 200, await res.text());
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, { areaCode: "130000" }, "args must arrive as the SECOND parameter");
      assert.ok(calls[0].context !== undefined, "context must be a defined value (empty object is fine), not omitted");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
