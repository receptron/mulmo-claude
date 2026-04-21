#!/usr/bin/env node

// Copies the root dist/ (server + client builds) into this package
// so `npm publish` includes them. Run before publishing:
//   cd packages/mulmoclaude && node bin/prepare-dist.js

import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dirname, "..");
const rootDir = join(pkgDir, "..", "..");
const rootDist = join(rootDir, "dist");
const pkgDist = join(pkgDir, "dist");

if (!existsSync(rootDist)) {
  console.error("Root dist/ not found. Run `yarn build` from the repo root first.");
  process.exit(1);
}

// Clean previous
if (existsSync(pkgDist)) {
  rmSync(pkgDist, { recursive: true });
}

// Copy server + client dist
mkdirSync(pkgDist, { recursive: true });
cpSync(join(rootDist, "client"), join(pkgDist, "client"), { recursive: true });
cpSync(join(rootDist, "server"), join(pkgDist, "server"), { recursive: true });

// Copy server workspace helps (seed files)
const helpsDir = join(rootDir, "server", "workspace", "helps");
if (existsSync(helpsDir)) {
  cpSync(helpsDir, join(pkgDist, "server", "server", "workspace", "helps"), { recursive: true });
}

console.log("dist/ prepared for publishing.");
console.log(`  client: ${join(pkgDist, "client")}`);
console.log(`  server: ${join(pkgDist, "server")}`);
