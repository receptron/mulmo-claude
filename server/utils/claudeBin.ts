// Cross-platform resolver for the Claude Code CLI executable.
//
// Background (Windows-specific): the npm global install of
// `@anthropic-ai/claude-code` ships:
//   - `claude.cmd` on PATH (Windows batch wrapper)
//   - `claude.exe` at `<npm-root>/node_modules/@anthropic-ai/claude-code/bin/`
//     (the real native binary)
//
// Node's `child_process.spawn` on Windows:
//   - cannot resolve `.cmd` since CVE-2024-27980 unless `shell: true`
//   - `shell: true` wraps via cmd.exe, which has an 8191-char command
//     line limit — MulmoClaude's MCP-config + system-prompt args
//     exceed it
//
// The cleanest fix is to point spawn directly at the bundled .exe.
// On non-Windows platforms, bare "claude" resolves through PATH as
// usual.
//
// Local patch 2026-05-30 / 2026-06-01 (extended to all spawn sites).
// Suitable as the base of an upstream PR to receptron/mulmoclaude.

import path from "node:path";

export function claudeBinPath(): string {
  if (process.platform !== "win32") return "claude";
  return path.join(
    process.env.APPDATA ?? "",
    "npm",
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );
}
