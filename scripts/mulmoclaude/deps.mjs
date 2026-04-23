// mulmoclaude dep audit (§1 of publish-mulmoclaude skill).
//
// Walk server/*.ts, extract every bare import specifier, and return
// the set that isn't declared in packages/mulmoclaude/package.json.
// If the list is non-empty, the published launcher will crash with
// ERR_MODULE_NOT_FOUND the first time that import is reached.
//
// JS port of the Python snippet in the skill so there's one language
// in the tree and it can be unit-tested from node:test.

import { readFile, readdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Node built-ins we must never flag as "missing dep". `node:module`
// publishes the authoritative list for whatever Node version we're
// running under — using it (vs. a hand-maintained set) means new
// built-ins like `async_hooks`, `diagnostics_channel`, `inspector`
// are covered without a follow-up PR. The `node:` prefix form is
// handled separately — anything starting with `node:` is a built-in
// by definition.
const NODE_BUILTINS = new Set(builtinModules);

// Returns true for `"fs"`, `"node:fs"`, `"fs/promises"`, `"node:fs/promises"`.
export function isNodeBuiltin(specifier) {
  if (specifier.startsWith("node:")) return true;
  const root = specifier.split("/")[0];
  return NODE_BUILTINS.has(root);
}

// Turns a specifier like `@scope/pkg/deep/path` or `pkg/sub` into
// the package name that would appear in dependencies — `@scope/pkg`
// and `pkg` respectively.
export function packageRoot(specifier) {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

// Pull every bare import specifier out of a TypeScript source string.
// Matches every standard TS top-level import/re-export shape:
//   import X from "pkg"
//   import { a, b } from "pkg"
//   import X, { a, b } from "pkg"        ← default + named combo
//   import X, * as Y from "pkg"          ← default + namespace combo
//   import { a,\n  b,\n } from "pkg"     ← multi-line brace
//   import "pkg"                          ← side-effect only
//   export { a } from "pkg"
//   export * from "pkg"
//   export type { T } from "pkg"
// Skips relative paths (`./`, `../`) and rooted paths (`/abs`).
//
// Not a full TS parser — regex is fine because we only care about
// the canonical top-of-file module-declaration shape, not arbitrary
// code. The `[\s\S]*?` lazy match lets one pattern cover every
// brace-y variant without listing each shape separately.
const IMPORT_PATTERNS = [
  // Single-line forms without braces:
  //   import X from "pkg"
  //   import * as Y from "pkg"
  //   export * from "pkg"
  //   export type T from "pkg"
  // `[^{\n]*` keeps the match on one line and bails before any
  // brace block, so free-form "from" tokens elsewhere in the file
  // can't be absorbed into the match.
  /^\s*(?:import|export)\b[^{\n]*\sfrom\s+['"]([^'"]+)['"]/gm,
  // Brace forms, single- or multi-line:
  //   import { a, b } from "pkg"
  //   import X, { a } from "pkg"            ← default + named combo
  //   import { a,\n  b,\n} from "pkg"       ← multi-line
  //   export { a } from "pkg"
  //   export type { T } from "pkg"
  // `(?:\w+\s*,\s*)?` handles the optional default-import-then-comma
  // before the brace; `\{[\s\S]*?\}` is non-greedy so adjacent
  // statements can't merge.
  /^\s*(?:import|export)(?:\s+type)?\s+(?:\w+\s*,\s*)?\{[\s\S]*?\}\s*from\s+['"]([^'"]+)['"]/gm,
  // Side-effect `import "pkg"` — no binding before the specifier.
  /^\s*import\s+['"]([^'"]+)['"]/gm,
  // Dynamic `import("pkg")` / `await import("pkg")`. Literal
  // specifiers only — `import(someVar)` is unanalysable and the
  // audit intentionally doesn't try to guess. Anchored to word
  // boundaries on `import` so it doesn't match `reimport("...")`.
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function extractBareImports(source) {
  const imports = new Set();
  for (const regex of IMPORT_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
      imports.add(packageRoot(specifier));
    }
  }
  return imports;
}

// Recursively walk `dir` looking for .ts files, skipping node_modules
// and hidden directories. Returns absolute paths.
export async function walkTsFiles(dir) {
  const out = [];
  async function recurse(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (err) {
      // Only swallow "directory isn't there" — callers preflight
      // against a fresh clone where /server may not yet exist.
      // Permission errors, ENOTDIR, transient IO failures etc.
      // must bubble up so the audit fails loud instead of passing
      // silently on an empty scan.
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await recurse(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
  }
  await recurse(dir);
  return out;
}

// Union of bare imports across every .ts file in `dir`.
export async function collectBareImports(dir) {
  const files = await walkTsFiles(dir);
  const imports = new Set();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const name of extractBareImports(source)) {
      imports.add(name);
    }
  }
  return imports;
}

// Full audit: compare collected bare imports against the package.json
// `dependencies`. Returns a sorted list of missing package names.
//
// Options:
//   root:            repo root (defaults to cwd)
//   serverDir:       where to walk for imports (defaults to `<root>/server`)
//   packageJsonPath: where the dependency allowlist lives
//                    (defaults to `<root>/packages/mulmoclaude/package.json`)
export async function auditServerDeps({ root = process.cwd(), serverDir, packageJsonPath } = {}) {
  const resolvedServer = serverDir ?? path.join(root, "server");
  const resolvedPkg = packageJsonPath ?? path.join(root, "packages", "mulmoclaude", "package.json");
  const pkgRaw = await readFile(resolvedPkg, "utf8");
  const pkg = JSON.parse(pkgRaw);
  // optionalDependencies satisfies a dynamic import with try/catch
  // (native modules that may fail to build). peerDependencies are
  // legitimate too when the consumer is expected to supply them.
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  const imports = await collectBareImports(resolvedServer);
  return [...imports].filter((name) => !declared.has(name) && !isNodeBuiltin(name)).sort();
}

// CLI entry point — `node scripts/mulmoclaude/deps.mjs` exits 1 and
// prints the missing packages if any are found. Silent (exit 0) on
// a clean audit so CI logs aren't noisy.
export async function main() {
  const missing = await auditServerDeps();
  if (missing.length === 0) {
    console.log("[mulmoclaude:deps] OK — no missing dependencies.");
    return 0;
  }
  console.error("[mulmoclaude:deps] MISSING from packages/mulmoclaude/package.json:");
  for (const name of missing) console.error(`  - ${name}`);
  console.error("");
  console.error("Add each to packages/mulmoclaude/package.json#dependencies, using the");
  console.error("version from the root package.json when present. See");
  console.error(".claude/skills/publish-mulmoclaude/SKILL.md §1 for the fix-up flow.");
  return 1;
}

// Only run the CLI when this file is invoked directly (not when
// imported by the smoke driver or by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const code = await main();
  process.exit(code);
}
