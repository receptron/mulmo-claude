// `src/core/` must not import a Node builtin (#3017).
//
// The browser entry reaches it: `src/vue/index.ts` → `core/plugin` →
// `core/paths`. A `node:path` import added there — as one was, to give a path
// helper a convenient default argument — lands in the Vue bundle, where the
// builtin does not exist. Neither the build nor lint complains; the consumer's
// bundler does, or worse, ships a broken chunk. So the rule is checked rather
// than remembered: `core/` takes its platform pieces as arguments.
//
// **Parsed, not pattern-matched.** Four rounds of review went into a regex
// that kept being almost right: it missed bare `import path from "path"`, then
// side-effect `import "path"`, then multiline `import {\n…\n} from "node:fs"`,
// while also flagging `export const label = "node:fs"` — a string that is not
// an import at all. Every fix enumerated one more form, and the forms are
// open-ended. TypeScript already knows what a module specifier is, so it is
// asked (Codex + CodeRabbit on #3017).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const CORE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "core");
const BUILTINS = new Set(builtinModules);

/**
 * Every module specifier the source imports — from the parser, not a pattern.
 *
 * `forEachChild` walks the real tree, so a specifier is found wherever the
 * grammar allows one and nowhere else: static and side-effect imports,
 * `export … from`, `import type`, `require()` and dynamic `import()`, however
 * they are spread across lines. A quoted builtin name that is NOT a specifier
 * (`const which = "path"`) is not a node this visitor stops on.
 */
export function importedSpecifiers(source: string): string[] {
  const file = ts.createSourceFile("probe.ts", source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = moduleSpecifierOf(node);
    if (specifier !== undefined) specifiers.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

function moduleSpecifierOf(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isCallExpression(node) && isModuleLoadCall(node.expression)) {
    const [first] = node.arguments;
    if (first && ts.isStringLiteral(first)) return first.text;
  }
  return undefined;
}

/** `require(…)` or a dynamic `import(…)` — the identifier itself, so
 *  `myrequire("path")` is not one of them. */
function isModuleLoadCall(expression: ts.Expression): boolean {
  return expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expression) && expression.text === "require");
}

/** A Node builtin, whether written `node:path` or bare `path`. */
export function isNodeBuiltin(specifier: string): boolean {
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  return BUILTINS.has(bare) || BUILTINS.has(`node:${bare}`);
}

function coreModules(): string[] {
  return readdirSync(CORE_DIR).filter((name) => name.endsWith(".ts"));
}

function builtinImportsIn(name: string): string[] {
  return importedSpecifiers(readFileSync(path.join(CORE_DIR, name), "utf8")).filter(isNodeBuiltin);
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
      const offenders = builtinImportsIn(name);
      assert.deepEqual(offenders, [], `${name} reaches the browser bundle — take the platform piece as an argument instead of importing it`);
    });
  }
});

describe("the guard finds a specifier wherever the grammar allows one", () => {
  // The detection IS the test, so it is pinned directly — every form that
  // walked past an earlier version of it included.
  const CAUGHT: ReadonlyArray<[string, string]> = [
    ["default import", 'import nodePath from "node:path";'],
    ["bare default import", 'import path from "path";'],
    ["named import", 'import { readFileSync } from "node:fs";'],
    ["bare named import", 'import { readFileSync } from "fs";'],
    ["side-effect import", 'import "path";'],
    ["side-effect import, prefixed", 'import "node:path";'],
    ["multiline import", 'import {\n  readFileSync,\n  writeFileSync,\n} from "node:fs";'],
    ["multiline default import", 'import\n  nodePath\nfrom "path";'],
    ["type-only import", 'import type { Stats } from "node:fs";'],
    ["namespace import", 'import * as os from "node:os";'],
    ["re-export", 'export { sep } from "path";'],
    ["star re-export", 'export * from "node:path";'],
    ["require", 'const p = require("path");'],
    ["dynamic import", 'const mod = await import("node:os");'],
  ];

  for (const [label, source] of CAUGHT) {
    it(`catches a ${label}`, () => {
      assert.ok(importedSpecifiers(source).some(isNodeBuiltin), `${label} must be recognised: ${JSON.stringify(source)}`);
    });
  }
});

describe("the guard does not flag things that only look like imports", () => {
  const ALLOWED: ReadonlyArray<[string, string]> = [
    ["a comment", "/** The slice of `node:path` this rule needs. */"],
    ["a workspace import", 'import { ARTIFACTS_ROOT } from "@mulmoclaude/core/artifacts";'],
    ["a relative import", 'import { normalizeStoryPath } from "./paths";'],
    ["a stylesheet", 'import "./styles.css";'],
    // Packages whose NAME contains a builtin's name.
    ["path-browserify", 'import { join } from "path-browserify";'],
    ["node-fetch", 'import x from "node-fetch";'],
    // Strings that are not specifiers — the false positives a line-based
    // regex produced.
    ["an exported constant", 'export const label = "node:fs";'],
    ["a local constant", 'const which = "path";'],
    ["a log argument", 'log.info("fs", "wrote the file");'],
    ["require-looking text inside a string", "const sample = 'require(\"node:fs\")';"],
    ["an identifier ending in require", 'myrequire("path");'],
  ];

  for (const [label, source] of ALLOWED) {
    it(`allows ${label}`, () => {
      const found = importedSpecifiers(source).filter(isNodeBuiltin);
      assert.deepEqual(found, [], `${label} must not be flagged: ${JSON.stringify(source)}`);
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
