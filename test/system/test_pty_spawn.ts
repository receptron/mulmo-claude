// Regression guard for `posix_spawnp failed`. node-pty execs its prebuilt
// `spawn-helper` before the target command, and that binary ships mode 644 in
// node-pty's npm tarball. This reproduces the broken end-user state — strip the
// executable bit as an `--ignore-scripts` install would leave it — then asserts
// the runtime guard restores it AND a real node-pty spawn succeeds instead of
// throwing. Skipped on Windows, where node-pty uses conpty and there is no
// spawn-helper.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { spawn, type IPty } from "node-pty";

import { ensureSpawnHelperExecutable, nodePtyPrebuildsDir } from "../../server/system/credentials.js";

const EXEC_BITS = 0o111;
const PTY_TIMEOUT_MS = 10_000;
const MARKER = "pty-spawn-ok";

function spawnHelperPaths(): string[] {
  const prebuilds = nodePtyPrebuildsDir();
  if (prebuilds === null) return [];
  return readdirSync(prebuilds)
    .map((platform) => join(prebuilds, platform, "spawn-helper"))
    .filter((helper) => existsSync(helper));
}

function spawnMarker(): Promise<string> {
  return new Promise((resolve, reject) => {
    let proc: IPty;
    try {
      proc = spawn("node", ["-e", `process.stdout.write("${MARKER}")`], { name: "xterm-color", cols: 80, rows: 30, cwd: process.cwd() });
    } catch (err) {
      // A non-executable spawn-helper surfaces here as "posix_spawnp failed".
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let buffer = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`node-pty spawn timed out after ${PTY_TIMEOUT_MS}ms`));
    }, PTY_TIMEOUT_MS);
    proc.onData((data) => {
      buffer += data;
    });
    proc.onExit(() => {
      clearTimeout(timer);
      resolve(buffer);
    });
  });
}

describe("ensureSpawnHelperExecutable", () => {
  it("restores +x on a non-executable spawn-helper and lets node-pty spawn", { skip: process.platform === "win32" }, async () => {
    const helpers = spawnHelperPaths();
    assert.ok(helpers.length > 0, "expected at least one node-pty spawn-helper prebuild");

    for (const helper of helpers) chmodSync(helper, statSync(helper).mode & ~EXEC_BITS);
    ensureSpawnHelperExecutable();
    for (const helper of helpers) {
      assert.ok((statSync(helper).mode & EXEC_BITS) !== 0, `guard should have restored +x on ${helper}`);
    }

    const output = await spawnMarker();
    assert.ok(output.includes(MARKER), `expected PTY output to include "${MARKER}", got: ${JSON.stringify(output)}`);
  });
});
