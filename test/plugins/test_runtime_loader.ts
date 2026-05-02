import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPluginFromCacheDir, isCacheValid, EXTRACT_MARKER, ensureInsideBase } from "../../server/plugins/runtime-loader.js";

interface FixtureOpts {
  exportsImport?: string;
  /** Override the entry-file content. Default exports a healthy
   *  TOOL_DEFINITION so the import loads cleanly. */
  entryContent?: string;
  /** When true, omit `package.json` to test missing-pkg behaviour. */
  omitPackageJson?: boolean;
  /** When true, write malformed JSON in `package.json`. */
  corruptPackageJson?: boolean;
}

function makeFixture(opts: FixtureOpts = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmo-runtime-loader-"));
  if (opts.omitPackageJson) return dir;
  const pkg = opts.corruptPackageJson
    ? "{ broken json"
    : JSON.stringify({
        name: "@fixture/plugin",
        version: "1.0.0",
        type: "module",
        exports: { ".": { import: opts.exportsImport ?? "./entry.js" } },
      });
  writeFileSync(path.join(dir, "package.json"), pkg);
  if (opts.corruptPackageJson) return dir;
  const entryPath = path.join(dir, opts.exportsImport ?? "entry.js");
  mkdirSync(path.dirname(entryPath), { recursive: true });
  writeFileSync(
    entryPath,
    opts.entryContent ??
      `export const TOOL_DEFINITION = {
  name: "fixture",
  description: "a fixture plugin for tests",
  parameters: { type: "object", properties: {} }
};
`,
  );
  return dir;
}

describe("loadPluginFromCacheDir", () => {
  it("loads a healthy plugin and returns RuntimePlugin", async () => {
    const dir = makeFixture();
    const plugin = await loadPluginFromCacheDir("@fixture/plugin", "1.0.0", dir);
    assert.ok(plugin);
    assert.equal(plugin?.name, "@fixture/plugin");
    assert.equal(plugin?.version, "1.0.0");
    assert.equal(plugin?.cachePath, dir);
    assert.equal(plugin?.definition.name, "fixture");
    assert.equal(plugin?.definition.description, "a fixture plugin for tests");
  });

  it("returns null when package.json is missing", async () => {
    const dir = makeFixture({ omitPackageJson: true });
    const plugin = await loadPluginFromCacheDir("@x/missing", "0.0.1", dir);
    assert.equal(plugin, null);
  });

  it("returns null when package.json is corrupt JSON", async () => {
    const dir = makeFixture({ corruptPackageJson: true });
    const plugin = await loadPluginFromCacheDir("@x/corrupt", "0.0.1", dir);
    assert.equal(plugin, null);
  });

  it("returns null when entry-point export has no TOOL_DEFINITION", async () => {
    const dir = makeFixture({ entryContent: "export const SOMETHING_ELSE = {};\n" });
    const plugin = await loadPluginFromCacheDir("@x/no-def", "0.0.1", dir);
    assert.equal(plugin, null);
  });

  it("returns null when TOOL_DEFINITION is the wrong shape", async () => {
    const dir = makeFixture({
      entryContent: `export const TOOL_DEFINITION = "not-an-object";\n`,
    });
    const plugin = await loadPluginFromCacheDir("@x/bad-shape", "0.0.1", dir);
    assert.equal(plugin, null);
  });

  it("falls through exports → module → main when resolving entry path", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mulmo-runtime-loader-fallback-"));
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@x/legacy-main",
        version: "1.0.0",
        type: "module",
        main: "./legacy.js",
      }),
    );
    writeFileSync(
      path.join(dir, "legacy.js"),
      `export const TOOL_DEFINITION = { name: "legacy", description: "main fallback" };
`,
    );
    const plugin = await loadPluginFromCacheDir("@x/legacy-main", "1.0.0", dir);
    assert.ok(plugin);
    assert.equal(plugin?.definition.name, "legacy");
  });

  it("returns null when no entry specifier resolvable", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mulmo-runtime-loader-noentry-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@x/empty", version: "1.0.0" }));
    const plugin = await loadPluginFromCacheDir("@x/empty", "1.0.0", dir);
    assert.equal(plugin, null);
  });

  it("ensureInsideBase: accepts paths inside the base", () => {
    const base = path.join(tmpdir(), "mulmo-base-positive");
    assert.equal(ensureInsideBase(path.join(base, "ok"), base), true);
    assert.equal(ensureInsideBase(path.join(base, "a", "b"), base), true);
    assert.equal(ensureInsideBase(base, base), true, "the base itself is inside the base");
  });

  it("ensureInsideBase: rejects lexical traversal escape", () => {
    const base = path.join(tmpdir(), "mulmo-base-traversal");
    // Mirrors what `path.join(base, ledgerName, version)` does when the
    // ledger entry is `"../../etc"`.
    assert.equal(ensureInsideBase(path.join(base, "..", "..", "etc"), base), false);
    assert.equal(ensureInsideBase(path.join(base, "..", "sibling"), base), false);
  });

  it("ensureInsideBase: rejects an absolute path outside the base", () => {
    const base = path.join(tmpdir(), "mulmo-base-absolute");
    assert.equal(ensureInsideBase("/etc/passwd", base), false);
  });

  it("ensureInsideBase: a base-prefix without separator is not enough", () => {
    // `/cache/foo` is NOT inside `/cache/fo`. Naive startsWith would
    // accept it; the explicit `path.sep` boundary check rejects it.
    const base = path.join(tmpdir(), "mulmo-base-prefix-fo");
    const sibling = path.join(tmpdir(), "mulmo-base-prefix-foo");
    assert.equal(ensureInsideBase(sibling, base), false);
  });

  it("isCacheValid: false on a directory missing the completion marker (partial extract)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mulmo-runtime-cache-partial-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@x/half", version: "1.0.0" }));
    // No EXTRACT_MARKER → cache is partial / invalid even though the
    // directory exists. This is what stops a sticky broken cache.
    assert.equal(isCacheValid(dir), false);
  });

  it("isCacheValid: true once the completion marker is present", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mulmo-runtime-cache-complete-"));
    writeFileSync(path.join(dir, EXTRACT_MARKER), "");
    assert.equal(isCacheValid(dir), true);
  });

  it("returns null when entry file is missing on disk", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mulmo-runtime-loader-missing-entry-"));
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "@x/missing-entry",
        version: "1.0.0",
        type: "module",
        exports: { ".": { import: "./gone.js" } },
      }),
    );
    const plugin = await loadPluginFromCacheDir("@x/missing-entry", "1.0.0", dir);
    assert.equal(plugin, null);
  });
});
