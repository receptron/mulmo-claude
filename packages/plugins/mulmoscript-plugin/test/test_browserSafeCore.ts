// `src/core/` must not import a Node builtin (#3017).
//
// The browser entry reaches it: `src/vue/index.ts` → `core/plugin` →
// `core/paths`. A `node:path` import added there — as one was, to give a path
// helper a convenient default argument — lands in the Vue bundle, where the
// builtin does not exist. The build does not complain; the consumer's bundler
// does, or worse, ships a broken chunk.
//
// So the rule is checked rather than remembered: `core/` takes its platform
// pieces as arguments.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CORE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "core");
/** `import x from "node:y"` / `require("node:y")` — not the word inside a comment. */
const NODE_BUILTIN_IMPORT = /(?:from\s*|require\(\s*)["']node:[a-z_/]+["']/;

describe("the browser-facing core imports no Node builtin", () => {
  const files = readdirSync(CORE_DIR).filter((name) => name.endsWith(".ts"));

  it("finds the core modules to check", () => {
    // Without this the sweep below passes by checking nothing.
    assert.ok(files.length >= 3, `expected several modules under src/core, found ${files.length}`);
    assert.ok(files.includes("paths.ts") && files.includes("plugin.ts"), `expected paths.ts and plugin.ts, got ${files.join(", ")}`);
  });

  for (const name of readdirSync(CORE_DIR).filter((f) => f.endsWith(".ts"))) {
    it(`${name} imports no node: builtin`, () => {
      const source = readFileSync(path.join(CORE_DIR, name), "utf8");
      const offender = source.split("\n").find((line) => NODE_BUILTIN_IMPORT.test(line));
      assert.equal(offender, undefined, `${name} reaches the browser bundle — take the platform piece as an argument instead of importing it`);
    });
  }

  it("the check can actually fail", () => {
    // The regex is the whole test; pin that it matches what it is meant to.
    assert.ok(NODE_BUILTIN_IMPORT.test('import nodePath from "node:path";'));
    assert.ok(NODE_BUILTIN_IMPORT.test('const p = require("node:fs");'));
    assert.ok(!NODE_BUILTIN_IMPORT.test(" * The slice of `node:path` this rule needs."));
  });
});
