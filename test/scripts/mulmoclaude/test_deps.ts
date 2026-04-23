// Unit tests for scripts/mulmoclaude/deps.mjs — the JS port of the
// SKILL.md §1 dep audit. Exercises the three public helpers
// individually plus the end-to-end `auditServerDeps` against the
// fixture trees under ./fixtures.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
// deps.mjs is plain JS — no types — so the import surface is loose.
// We declare the shape we actually use to keep the rest of the file
// typed without introducing a .d.ts for a CLI helper.
import * as deps from "../../../scripts/mulmoclaude/deps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

describe("extractBareImports", () => {
  it("handles default + named + side-effect import forms", () => {
    const source = `
      import defaultX from "pkg-a";
      import { b, c } from "pkg-b";
      import "pkg-c";
      import defaultD, { e } from "pkg-d";
      export { f } from "pkg-e";
      export * from "pkg-f";
    `;
    const found = [...deps.extractBareImports(source)].sort();
    assert.deepEqual(found, ["pkg-a", "pkg-b", "pkg-c", "pkg-d", "pkg-e", "pkg-f"]);
  });

  it("handles multi-line brace imports", () => {
    const source = `
      import {
        a,
        b,
        c,
      } from "pkg-multi";
    `;
    assert.ok(deps.extractBareImports(source).has("pkg-multi"));
  });

  it("strips deep subpaths to the package root", () => {
    const source = `
      import x from "mammoth/lib/foo";
      import y from "@google/genai/deep/module";
      import z from "pkg/sub/path";
    `;
    const found = [...deps.extractBareImports(source)].sort();
    assert.deepEqual(found, ["@google/genai", "mammoth", "pkg"]);
  });

  it("ignores relative and rooted specifiers", () => {
    const source = `
      import a from "./sibling";
      import b from "../parent";
      import c from "/absolute/path";
      import d from "real-pkg";
    `;
    const found = [...deps.extractBareImports(source)];
    assert.deepEqual(found, ["real-pkg"]);
  });

  it("ignores specifiers that appear inside line comments or strings", () => {
    // Our regex anchors on `^\s*(?:import|export)` so something like
    // the commented-out line below must not be matched.
    const source = `
      // import shouldnotmatch from "fake-pkg";
      const literal = 'import x from "another-fake-pkg"';
      import real from "real-pkg";
    `;
    const found = [...deps.extractBareImports(source)];
    assert.deepEqual(found, ["real-pkg"]);
  });

  it("returns an empty set for files with no imports", () => {
    assert.equal(deps.extractBareImports("export const x = 1;\n").size, 0);
    assert.equal(deps.extractBareImports("").size, 0);
  });

  it("detects dynamic import() with literal specifier", () => {
    const source = `
      async function load() {
        const mod = await import("dynamic-pkg");
        const other = import("@scope/dyn");
        return [mod, other];
      }
    `;
    const found = [...deps.extractBareImports(source)].sort();
    assert.deepEqual(found, ["@scope/dyn", "dynamic-pkg"]);
  });

  it("ignores dynamic import() with variable specifier", () => {
    // Audit can't resolve runtime values — by design, \`import(var)\`
    // is invisible to the regex and left for the operator to flag
    // manually if the var happens to name an undeclared package.
    const source = `
      const name = "dynamic-pkg";
      const mod = await import(name);
    `;
    assert.equal(deps.extractBareImports(source).size, 0);
  });
});

describe("packageRoot", () => {
  it("leaves bare package names untouched", () => {
    assert.equal(deps.packageRoot("express"), "express");
  });

  it("strips subpath from unscoped packages", () => {
    assert.equal(deps.packageRoot("mammoth/lib/foo"), "mammoth");
  });

  it("keeps scope + name for scoped packages", () => {
    assert.equal(deps.packageRoot("@scope/pkg"), "@scope/pkg");
  });

  it("strips subpath from scoped packages", () => {
    assert.equal(deps.packageRoot("@google/genai/deep/module"), "@google/genai");
  });
});

describe("isNodeBuiltin", () => {
  it("recognises bare built-ins", () => {
    for (const name of ["fs", "path", "crypto", "child_process", "worker_threads"]) {
      assert.equal(deps.isNodeBuiltin(name), true, `${name} should be builtin`);
    }
  });

  it("recognises node: prefixed specifiers (with and without subpath)", () => {
    assert.equal(deps.isNodeBuiltin("node:fs"), true);
    assert.equal(deps.isNodeBuiltin("node:fs/promises"), true);
    assert.equal(deps.isNodeBuiltin("node:crypto"), true);
  });

  it("recognises fs/promises as built-in (fs subpath)", () => {
    // Important because the walker keeps the fully-qualified name
    // `fs/promises` in the intermediate set — passing it through
    // `packageRoot` first yields `fs`, which is built-in.
    assert.equal(deps.isNodeBuiltin("fs/promises"), true);
  });

  it("rejects real packages", () => {
    for (const name of ["express", "@scope/pkg", "mammoth"]) {
      assert.equal(deps.isNodeBuiltin(name), false, `${name} should NOT be builtin`);
    }
  });
});

describe("auditServerDeps (end-to-end)", () => {
  it("reports no missing deps on the 'clean' fixture", async () => {
    const missing = await deps.auditServerDeps({
      root: path.join(FIXTURES, "clean"),
    });
    assert.deepEqual(missing, []);
  });

  it("reports missing packages on the 'missing' fixture, sorted", async () => {
    const missing = await deps.auditServerDeps({
      root: path.join(FIXTURES, "missing"),
    });
    // Alphabetical: @google/genai, mammoth, puppeteer.
    // express is declared, node:crypto is filtered as built-in.
    assert.deepEqual(missing, ["@google/genai", "mammoth", "puppeteer"]);
  });

  it("never reports Node built-ins as missing, even when package.json omits them", async () => {
    const missing = await deps.auditServerDeps({
      root: path.join(FIXTURES, "missing"),
    });
    for (const builtin of ["fs", "node:fs", "node:crypto", "path"]) {
      assert.ok(!missing.includes(builtin), `${builtin} leaked into missing list`);
    }
  });

  it("throws a readable error when the package.json is absent", async () => {
    await assert.rejects(
      deps.auditServerDeps({
        root: path.join(FIXTURES, "clean"),
        packageJsonPath: "/does/not/exist/package.json",
      }),
      /ENOENT/,
    );
  });

  it("treats a missing server directory as empty (nothing to audit)", async () => {
    const missing = await deps.auditServerDeps({
      root: path.join(FIXTURES, "clean"),
      serverDir: path.join(FIXTURES, "clean", "does-not-exist"),
    });
    assert.deepEqual(missing, []);
  });
});
