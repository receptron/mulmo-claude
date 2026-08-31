// `src/core/` must not import a Node builtin (#3017).
//
// The browser entry reaches it: `src/vue/index.ts` → `core/plugin` →
// `core/paths`. A `node:path` import added there — as one was, to give a path
// helper a convenient default argument — lands in the Vue bundle, where the
// builtin does not exist. Neither the build nor lint complains; the consumer's
// bundler does, or worse, ships a broken chunk. So the rule is checked rather
// than remembered: `core/` takes its platform pieces as arguments.
//
// The list of builtins comes from NODE, not from this file. The first version
// matched `node:*` only, and `import path from "path"` — equally valid, and
// what most of this repo actually writes — would have put the dependency
// straight back with the guard green (Codex on #3017). A rule enforced by a
// list someone maintains is the failure this whole line of work keeps hitting.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CORE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "core");
const BUILTINS = new Set(builtinModules);

/** Every module specifier the line imports from, however it spells it. */
function importedSpecifiers(line: string): string[] {
  const specifiers: string[] = [];
  for (const match of line.matchAll(/(?:from\s*|require\(\s*|import\(\s*)["']([^"']+)["']/g)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

/** A Node builtin, whether written `node:path` or bare `path`. */
function isNodeBuiltin(specifier: string): boolean {
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  return BUILTINS.has(bare) || BUILTINS.has(`node:${bare}`);
}

function coreModules(): string[] {
  return readdirSync(CORE_DIR).filter((name) => name.endsWith(".ts"));
}

function findBuiltinImport(name: string): string | undefined {
  const source = readFileSync(path.join(CORE_DIR, name), "utf8");
  return source.split("\n").find((line) => importedSpecifiers(line).some(isNodeBuiltin));
}

describe("the browser-facing core imports no Node builtin", () => {
  it("finds the core modules to check", () => {
    // Without this the sweep below passes by checking nothing.
    const files = coreModules();
    assert.ok(files.length >= 3, `expected several modules under src/core, found ${files.length}`);
    assert.ok(files.includes("paths.ts") && files.includes("plugin.ts"), `expected paths.ts and plugin.ts, got ${files.join(", ")}`);
  });

  for (const name of coreModules()) {
    it(`${name} imports no Node builtin`, () => {
      const offender = findBuiltinImport(name);
      assert.equal(offender, undefined, `${name} reaches the browser bundle — take the platform piece as an argument instead of importing it`);
    });
  }
});

describe("the guard recognises every spelling of a builtin import", () => {
  // The detection IS the test, so it is pinned directly — including the bare
  // form the first version missed.
  const CAUGHT = [
    'import nodePath from "node:path";',
    'import path from "path";',
    'import { readFileSync } from "node:fs";',
    'import { readFileSync } from "fs";',
    'const p = require("path");',
    'const p = require("node:path");',
    'export { sep } from "path";',
    'const mod = await import("node:os");',
  ];
  const ALLOWED = [
    " * The slice of `node:path` this rule needs.",
    'import { ARTIFACTS_ROOT } from "@mulmoclaude/core/artifacts";',
    'import { normalizeStoryPath } from "./paths";',
    'import type { MulmoBeat } from "@mulmocast/types";',
    // A package whose name merely CONTAINS a builtin's name is not one.
    'import { join } from "path-browserify";',
    'import x from "node-fetch";',
  ];

  for (const line of CAUGHT) {
    it(`catches ${line}`, () => {
      assert.ok(importedSpecifiers(line).some(isNodeBuiltin), line);
    });
  }

  for (const line of ALLOWED) {
    it(`allows ${line.trim().slice(0, 48)}`, () => {
      assert.ok(!importedSpecifiers(line).some(isNodeBuiltin), line);
    });
  }

  it("takes its builtin list from Node itself", () => {
    // Not from a list in this file — that is the shape the first version got
    // wrong, and the shape that rots as Node adds builtins.
    assert.ok(BUILTINS.size > 30, `expected Node's builtin list, got ${BUILTINS.size} entries`);
    for (const expected of ["path", "fs", "os", "url", "crypto"]) {
      assert.ok(isNodeBuiltin(expected), `${expected} must be recognised as a builtin`);
    }
  });
});
