// Cross-platform resolver for the Claude Code CLI executable.
//
// Background (Windows-specific): the npm global install of
// `@anthropic-ai/claude-code` ships:
//   - `claude.cmd` on PATH (Windows batch wrapper)
//   - `claude.exe` under the global `node_modules` tree (real native
//     binary the .cmd wrapper delegates to)
//
// Node's `child_process.spawn` on Windows:
//   - cannot resolve `.cmd` since CVE-2024-27980 unless `shell: true`
//   - `shell: true` wraps via cmd.exe, which has an 8191-char command
//     line limit that MulmoClaude's MCP-config + system-prompt args
//     comfortably exceed in normal operation
//
// The cleanest fix is to point spawn directly at the bundled `.exe`.
// We probe a small set of candidate npm-global prefixes and verify
// the file exists before returning. If no candidate matches we
// fall back to bare "claude" — spawn() will then attempt PATH
// resolution and surface the original failure honestly rather than
// masking it behind a constructed-but-nonexistent path.
//
// On non-Windows platforms, bare "claude" resolves through PATH as
// usual.
//
// The result is memoised so the existsSync probe (and the
// `npm prefix -g` shell-out below) runs at most once per process.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const CLAUDE_EXE_REL = path.join(
  "node_modules",
  "@anthropic-ai",
  "claude-code",
  "bin",
  "claude.exe",
);

let memoised: string | null = null;

export function claudeBinPath(): string {
  if (memoised !== null) return memoised;
  memoised = resolveClaudeBinPath();
  return memoised;
}

function resolveClaudeBinPath(): string {
  if (process.platform !== "win32") return "claude";

  const candidates: string[] = [];

  // 1. Default npm prefix on Windows: %APPDATA%\npm.
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "npm", CLAUDE_EXE_REL));
  }

  // 2. Same shape under %LOCALAPPDATA% — some installers default here.
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "npm", CLAUDE_EXE_REL));
  }

  // 3. Whatever `npm prefix -g` reports. Covers nvm-windows and
  //    similar setups that move the prefix outside the AppData dirs.
  const npmPrefix = readNpmGlobalPrefix();
  if (npmPrefix) {
    candidates.push(path.join(npmPrefix, CLAUDE_EXE_REL));
  }

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) {
      return candidate;
    }
  }

  // No prebuilt `.exe` found. Fall back to bare "claude" — spawn()
  // will then attempt PATH resolution. On a typical Windows install
  // this surfaces as ENOENT (Node looks for an extensionless binary)
  // or EINVAL (PATH-resolution lands on `claude.cmd`), which is the
  // original failure mode — honestly surfaced rather than masked
  // behind a constructed-but-nonexistent absolute path.
  return "claude";
}

function readNpmGlobalPrefix(): string | null {
  try {
    // Sync subprocess: runs at most once per process due to the
    // memoisation in claudeBinPath().
    const out = execSync("npm prefix -g", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    // npm not on PATH, or timed out, or non-zero exit. The other
    // candidate paths still cover the default install layout.
    return null;
  }
}
