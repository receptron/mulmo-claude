// Tests for `server/utils/launcher/macos/resolve-path.sh`.
//
// This is the piece that decides whether a Finder double-click finds the
// user's toolchain at all. A GUI launch starts with
// PATH=/usr/bin:/bin:/usr/sbin:/sbin and no version manager on it, so
// every case here runs the script under that same stripped environment
// rather than the ambient one.
//
// macOS-only: the script exists to work around launchd's environment and
// leans on `dscl`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ONE_SECOND_MS } from "../../../server/utils/time.ts";

const SCRIPT = join(process.cwd(), "server", "utils", "launcher", "macos", "resolve-path.sh");
const GUI_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const darwinOnly = { skip: process.platform !== "darwin" };

// Runs a shell snippet with the script sourced, under the environment a
// GUI launch actually gets. Absolute paths reach the shell as environment
// values rather than being interpolated into the command string, so no
// path this test discovers can alter the command's shape.
// The hanging-shell case depends on the script's own watchdog firing.
// Without a hard ceiling here, a regression in that watchdog would hang
// CI instead of failing it, so the subprocess is bounded well above the
// longest legitimate run.
const SHELL_TIMEOUT_MS = 30 * ONE_SECOND_MS;

const runShell = (script: string, home: string, extraEnv: Record<string, string> = {}): { stdout: string; ms: number } => {
  const startedAt = Date.now();
  const stdout = execFileSync("/bin/sh", ["-c", `. "$MC_SCRIPT"\n${script}`], {
    encoding: "utf8",
    env: { HOME: home, PATH: GUI_PATH, TMPDIR: tmpdir(), MC_SCRIPT: SCRIPT, ...extraEnv },
    timeout: SHELL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return { stdout, ms: Date.now() - startedAt };
};

const writeExecutable = (path: string, contents: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
};

const withTempHome = (body: (home: string) => void) => {
  const home = mkdtempSync(join(tmpdir(), "mulmoclaude-home-"));
  try {
    body(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

describe("resolve-path.sh", () => {
  it("returns the login shell's PATH ahead of the inherited one", darwinOnly, () => {
    withTempHome((home) => {
      const fakeShell = join(home, "fake-shell");
      // Invoked as `<shell> -l -i -c <script>`, so the script is $4.
      writeExecutable(fakeShell, '#!/bin/sh\nexec /bin/sh -c "$4"\n');
      const { stdout } = runShell('mc_login_shell() { echo "$MC_FAKE_SHELL"; }\nmc_resolve_path', home, { MC_FAKE_SHELL: fakeShell });
      assert.equal(stdout.trim(), `${GUI_PATH}:${GUI_PATH}`);
    });
  });

  it("asks for an interactive login shell — version managers live in .zshrc, which -l alone never reads", darwinOnly, () => {
    withTempHome((home) => {
      // Records the flags it was invoked with instead of answering.
      const fakeShell = join(home, "record-flags");
      const flagLog = join(home, "flags.txt");
      writeExecutable(fakeShell, '#!/bin/sh\necho "$1 $2 $3" > "$MC_FLAG_LOG"\n');
      runShell('mc_login_shell() { echo "$MC_FAKE_SHELL"; }\nmc_resolve_path > /dev/null', home, { MC_FAKE_SHELL: fakeShell, MC_FLAG_LOG: flagLog });
      const flags = readFileSync(flagLog, "utf8");
      assert.match(flags, /-l/);
      assert.match(flags, /-i/);
      assert.match(flags, /-c/);
    });
  });

  it("ignores banner noise around the sentinels", darwinOnly, () => {
    withTempHome((home) => {
      const fakeShell = join(home, "noisy-shell");
      writeExecutable(
        fakeShell,
        ["#!/bin/sh", 'echo "welcome to my shell"', 'echo "some warning" >&2', '/bin/sh -c "$4"', 'echo "trailing chatter"', ""].join("\n"),
      );
      const { stdout } = runShell('mc_login_shell() { echo "$MC_FAKE_SHELL"; }\nmc_resolve_path', home, { MC_FAKE_SHELL: fakeShell });
      assert.ok(!stdout.includes("welcome"), "banner leaked into the resolved PATH");
      assert.ok(!stdout.includes("chatter"), "trailing output leaked into the resolved PATH");
      assert.ok(stdout.trim().startsWith(`${GUI_PATH}:`), `unexpected resolved PATH: ${stdout.trim()}`);
    });
  });

  it("gives up on a shell that hangs instead of wedging the launch", darwinOnly, () => {
    withTempHome((home) => {
      const fakeShell = join(home, "hanging-shell");
      writeExecutable(fakeShell, "#!/bin/sh\nsleep 30\n");
      const { ms } = runShell('MC_HOP_TIMEOUT_S=2\nmc_login_shell() { echo "$MC_FAKE_SHELL"; }\nmc_resolve_path > /dev/null', home, {
        MC_FAKE_SHELL: fakeShell,
      });
      assert.ok(ms < 10_000, `took ${ms}ms — the watchdog did not fire`);
      assert.ok(ms >= 2_000, `took ${ms}ms — returned before the timeout, so nothing was actually waited for`);
    });
  });

  it("does not stall for the whole timeout when the shell answers immediately", darwinOnly, () => {
    withTempHome((home) => {
      const fakeShell = join(home, "fast-shell");
      // Invoked as `<shell> -l -i -c <script>`, so the script is $4.
      writeExecutable(fakeShell, '#!/bin/sh\nexec /bin/sh -c "$4"\n');
      // Regression guard: a watchdog whose stdout is not detached keeps
      // the command substitution's pipe open, and every launch pays the
      // full timeout even though the work finished in milliseconds.
      const { ms } = runShell('MC_HOP_TIMEOUT_S=20\nmc_login_shell() { echo "$MC_FAKE_SHELL"; }\nmc_resolve_path > /dev/null', home, {
        MC_FAKE_SHELL: fakeShell,
      });
      assert.ok(ms < 10_000, `took ${ms}ms — the watchdog is holding the output pipe open`);
    });
  });

  it("scans for claude as well as node, so a tools-only directory is not dropped", darwinOnly, () => {
    withTempHome((home) => {
      // Claude Code installs to ~/.local/bin, which typically has no
      // node in it. Scanning for node alone would drop this directory
      // and then report Claude Code as missing on a machine that has it.
      writeExecutable(join(home, ".local", "bin", "claude"), "#!/bin/sh\necho 1.0.0\n");
      const { stdout } = runShell('mc_login_path() { echo ""; }\nmc_resolve_path', home);
      assert.ok(stdout.trim().startsWith(`${home}/.local/bin:`), `scan dropped the claude-only dir: ${stdout.trim()}`);
    });
  });

  it("still yields a usable PATH when the shell hop finds nothing at all", darwinOnly, () => {
    withTempHome((home) => {
      const { stdout } = runShell('mc_login_path() { echo ""; }\nmc_resolve_path', home);
      // The scan also probes absolute locations (/opt/homebrew/bin,
      // /usr/local/bin) whose contents depend on the machine running
      // the test, so only the invariant is asserted: whatever it finds
      // is prepended, and the inherited entries survive at the tail.
      assert.ok(stdout.trim().endsWith(GUI_PATH), `inherited PATH lost: ${stdout.trim()}`);
    });
  });
});
