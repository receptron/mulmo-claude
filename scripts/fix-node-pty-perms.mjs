// Restore the executable bit on node-pty's `spawn-helper` prebuilt binary.
//
// node-pty execs `spawn-helper` on Unix before it can exec the target
// command; without +x that exec fails and node-pty throws
// `posix_spawnp failed`. Yarn Classic (1.x) drops the executable bit when it
// extracts prebuilt binaries from its cache, so a yarn-installed tree loses it
// (npm preserves it). Runs on `postinstall`; idempotent and a no-op when
// node-pty is absent or ships no spawn-helper (Windows uses conpty).

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
  // Best-effort: a permission fixer must never fail `yarn install`.
  console.warn(`[fix-node-pty-perms] skipped: ${err}`);
}
