#!/usr/bin/env node

// Copies server source + client build + shared config into this
// package so `npm publish` includes everything needed to run.
//
// Run before publishing:
//   yarn build   # build client
//   node packages/mulmoclaude/bin/prepare-dist.js

import { cpSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dirname, "..");
const rootDir = join(pkgDir, "..", "..");

// ── Clean ───────────────────────────────────────────────────

// Include `dist` so leftovers from the older pre-built-JS layout are
// wiped on re-run.
for (const dir of ["dist", "client", "server", "src"]) {
  const target = join(pkgDir, dir);
  if (existsSync(target)) rmSync(target, { recursive: true });
}

// ── Client dist (Vite build output) ─────────────────────────
// Copied to `client/` (not `dist/client/`) so the server's
// `path.join(__dirname, "../client")` resolves correctly when
// tsx runs `server/index.ts` directly from this package.

const clientDist = join(rootDir, "dist", "client");
if (!existsSync(clientDist)) {
  console.error("dist/client/ not found. Run `yarn build` first.");
  process.exit(1);
}
cpSync(clientDist, join(pkgDir, "client"), { recursive: true });
console.log("✓ client");

// ── Server source (TypeScript — run via tsx) ────────────────

cpSync(join(rootDir, "server"), join(pkgDir, "server"), {
  recursive: true,
  filter: (src) => {
    if (src.includes("node_modules")) return false;
    if (src.endsWith(".map")) return false;
    if (src.endsWith(".log")) return false;
    // Skip dev-only files: local logs dir, tsconfig used by repo's
    // own `tsc -p server/tsconfig.json` (end users don't compile).
    const tail = src.split("/").slice(-2).join("/");
    if (tail === "server/logs" || src.endsWith("/server/logs")) return false;
    if (src.endsWith("/tsconfig.json")) return false;
    return true;
  },
});
console.log("✓ server source");

// ── Shared src/ (server imports from src/config, src/types,
//    src/plugins, src/utils). Copy the whole tree — Vue files are
//    ignored at runtime since the server never imports them.

cpSync(join(rootDir, "src"), join(pkgDir, "src"), {
  recursive: true,
  filter: (src) => !src.endsWith(".map"),
});
console.log("✓ shared src/");

console.log("\nReady to publish. Run:");
console.log("  cd packages/mulmoclaude && npm publish --access public");
