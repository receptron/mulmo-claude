// Regression test for the cache-root anchor check on the runtime
// plugin asset route (#1043 C-2 codex iter-3).
//
// `decodeURIComponent` runs AFTER Express route matching and the
// bearer-auth exemption in server/index.ts, so percent-encoded `../`
// in `pkg` / `version` segments reaches the route handler. Without
// the anchor check, an unauthenticated GET could escape the plugin
// cache directory and read arbitrary files.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolvePluginRoot } from "../../../server/api/routes/runtime-plugin.ts";
import { WORKSPACE_PATHS } from "../../../server/workspace/paths.ts";

const realCacheRoot = WORKSPACE_PATHS.pluginCache;
let scratchRoot: string;
let outsideTarget: string;

before(() => {
  // Build a fresh fixture inside the real cache root so realpath
  // resolution actually returns the cache root prefix. The runtime
  // loader normally creates this on first install; tests force it.
  scratchRoot = mkdtempSync(path.join(tmpdir(), "mulmo-runtime-anchor-fixture-"));
  outsideTarget = path.join(scratchRoot, "outside");
  mkdirSync(outsideTarget, { recursive: true });
  writeFileSync(path.join(outsideTarget, "secret.txt"), "should-not-leak");
  mkdirSync(path.join(realCacheRoot, "@fixture", "anchor-test", "1.0.0"), { recursive: true });
  writeFileSync(path.join(realCacheRoot, "@fixture", "anchor-test", "1.0.0", "marker"), "ok");
});

after(() => {
  try {
    rmSync(path.join(realCacheRoot, "@fixture"), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  try {
    rmSync(scratchRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("resolvePluginRoot — anchor check", () => {
  it("returns the realpath for a plugin inside the cache root", () => {
    const result = resolvePluginRoot("@fixture/anchor-test", "1.0.0");
    assert.ok(result, "expected a realpath for the in-cache plugin dir");
    assert.match(result ?? "", /@fixture[\\/]anchor-test[\\/]1\.0\.0$/);
  });

  it("returns null for a non-existent plugin dir (404 path)", () => {
    const result = resolvePluginRoot("@fixture/never-installed", "0.0.0");
    assert.equal(result, null);
  });

  it("blocks `pkg` segment containing `../`", () => {
    // Simulates what `decodeURIComponent` produces from `..%2F..` in
    // the URL: a single string with embedded slashes that path.join
    // collapses into a parent-directory traversal.
    const result = resolvePluginRoot("../../../../etc", "passwd");
    assert.equal(result, null, "encoded traversal in :pkg must escape and be rejected");
  });

  it("blocks `version` segment containing `../`", () => {
    const result = resolvePluginRoot("@fixture/anchor-test", "../../../../tmp");
    assert.equal(result, null, "encoded traversal in :version must escape and be rejected");
  });

  it("blocks `pkg` of `..` alone", () => {
    const result = resolvePluginRoot("..", "1.0.0");
    assert.equal(result, null);
  });

  it("blocks empty string `pkg` (would land on cache root parent)", () => {
    // `path.join(cacheRoot, "", "1.0.0")` → `cacheRoot/1.0.0`. The
    // path doesn't exist on disk so realpath fails, but explicitly
    // assert null in case the directory ever exists by accident.
    const result = resolvePluginRoot("", "1.0.0");
    assert.equal(result, null);
  });
});
