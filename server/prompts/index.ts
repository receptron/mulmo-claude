// Static system-prompt blocks, loaded from `server/prompts/system/*.md`
// at module init. These are app-owned constants (model-read English,
// never user-visible, never edited at runtime), so a synchronous read
// at import time is correct — no async plumbing, no per-request I/O.
//
// Most content is returned verbatim. The sandbox block is the one
// historical inline fragment without a trailing newline; normalize
// exactly one editor-added LF for that file so buildSystemPrompt keeps
// its load-bearing separator shape.
//
// Path is resolved relative to this module (import.meta.url), NOT
// process.cwd(), so it resolves under both the dev server and the
// npx-installed launcher (which ships the whole `server/` tree).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEM_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "system");

function load(name: string): string {
  return readFileSync(path.join(SYSTEM_DIR, name), "utf-8");
}

export const SYSTEM_PROMPT = load("system.md");
export const TOPIC_MEMORY_MANAGEMENT = load("memory-management-topic.md");
export const ATOMIC_MEMORY_MANAGEMENT = load("memory-management-atomic.md");
// sandbox-tools.md mirrors the tool set installed by
// Dockerfile.sandbox — if you add/remove a tool there, update the
// .md so the prompt-level mention stays in sync with the image.
export const SANDBOX_TOOLS_HINT = load("sandbox-tools.md").replace(/\n$/, "");

// Static blocks emitted behind a runtime guard (the guard / message
// wrapping stays in prompt.ts; only the prose lives here). No trailing
// newline — these reproduce `[…].join("\n")` outputs verbatim.
export const JOURNAL_POINTER = load("journal-pointer.md");
