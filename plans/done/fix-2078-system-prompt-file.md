# fix #2078 — Windows ENAMETOOLONG on large inline `--system-prompt`

## Problem

On Windows the server spawns the `claude` CLI with the entire assembled system
prompt inline as `--system-prompt <text>`. Windows `CreateProcess` caps the whole
command line at ~32k chars, so any workspace whose role + plugins + memory push
the prompt past that fails **every** message with `spawn ENAMETOOLONG` before the
CLI even starts. It is environment-dependent and grows with workspace richness,
so it reads as random breakage (one role works, another doesn't; yesterday's
role starts failing after memory grows).

## Fix

Write the prompt to a per-session file and pass `--system-prompt-file` instead,
reusing the exact host/container path split the per-session MCP config already
uses (`resolveMcpConfigPaths`).

- `server/agent/config.ts`
  - `CliArgsParams.systemPrompt: string` → `systemPromptPath: string`.
  - `buildCliArgs` emits `--system-prompt-file <path>` instead of `--system-prompt <text>`.
  - New `resolveSystemPromptPaths(...)` mirroring `resolveMcpConfigPaths`:
    workspace `.mulmoclaude/system-prompt-<sid>.md` under Docker (so the
    container-side CLI reads it through the bind mount), OS tmpdir natively,
    same `safeSessionSegment` sessionId sanitisation against path injection.
  - The shared `{ hostPath, argPath }` return type is generalised from
    `McpConfigPaths` to `SessionFilePaths` (both resolvers return it).
- `server/agent/backend/claude-code.ts`
  - `writeSystemPromptFile(input)` writes the prompt with `writeFileAtomic`
    before spawn (one file per chat session, overwritten each turn, mirroring
    the MCP config lifecycle) and returns the CLI arg path.
  - `cliArgsForInput(input, systemPromptPath)` takes the resolved path.
- `AgentInput.systemPrompt` (the text) is unchanged — the backend is the only
  place that materialises it to a file.

## Flag verification

`--system-prompt-file <file>` is a real, registered Claude CLI flag (probed on
2.1.210: unknown flags are rejected, this one reports "argument missing"). The
issue reporter validated the same on 2.1.204.

## Tests

- `resolveSystemPromptPaths`: native path, docker path, docker host≠arg, and
  path-injection/sessionId-sanitisation coverage (mirrors the existing
  `resolveMcpConfigPaths` tests).
- Regression: the prompt travels as a `--system-prompt-file` path and inline
  `--system-prompt` is **never** emitted; `cliArgsForInput` carries the path,
  not the text.

## Notes / non-goals

- The prompt file is overwritten each turn and not explicitly unlinked (the
  issue's "overwrite each turn" lifecycle). Native files land in the OS tmpdir;
  Docker files in `<workspace>/.mulmoclaude/`.
- Windows-specific bug that cannot reproduce on macOS/Linux; correctness is
  guarded by the unit tests above.
