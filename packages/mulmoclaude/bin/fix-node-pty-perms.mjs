// Restore the executable bit on node-pty's `spawn-helper` prebuilt binary.
//
// node-pty ships `spawn-helper` mode 644 in its npm tarball, and neither npm
// nor yarn adds the executable bit on install. On Unix node-pty must exec
// `spawn-helper` before it can exec the target command, so without +x that exec
// fails and node-pty throws `posix_spawnp failed` (surfaced here as the OAuth
// token renewal for the Docker sandbox failing). Runs on `postinstall`;
// idempotent, and a no-op when node-pty (an optional dependency) is absent or
// ships no spawn-helper (Windows uses conpty). Self-contained because this
// package is published to npm and cannot reach the monorepo's root script.

import { createRequire } from "node:module";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const EXEC_BITS = 0o111;

function findNodePtyRoot() {
  const require = createRequire(import.meta.url);
  let dir;
  try {
    dir = dirname(require.resolve("node-pty"));
  } catch {
    return null; // node-pty not installed — nothing to fix
  }
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "prebuilds"))) return dir;
    dir = dirname(dir);
  }
  return null;
}

function restoreExecBit(helper) {
  const { mode } = statSync(helper);
  const withExec = mode | EXEC_BITS;
  if (withExec === mode) return false;
  chmodSync(helper, withExec);
  return true;
}

function main() {
  const root = findNodePtyRoot();
  if (!root) return;
  const prebuilds = join(root, "prebuilds");
  if (!existsSync(prebuilds)) return;

  const fixed = readdirSync(prebuilds)
    .map((platform) => join(prebuilds, platform, "spawn-helper"))
    .filter((helper) => existsSync(helper))
    .filter(restoreExecBit).length;

  if (fixed > 0) {
    console.log(`[fix-node-pty-perms] restored +x on ${fixed} node-pty spawn-helper binary(ies)`);
  }
}

try {
  main();
} catch (err) {
  // Best-effort: a permission fixer must never fail `npm install` / `yarn install`.
  console.warn(`[fix-node-pty-perms] skipped: ${err}`);
}
