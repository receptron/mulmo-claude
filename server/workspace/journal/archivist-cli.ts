// Transport layer for the journal archivist: previously spawned the
// Claude Code CLI as a subprocess directly. As of PR #2 of the LLM
// backend abstraction (plans/refactor-llm-backend-abstraction.md),
// the spawn body lives in server/agent/backend/claude-code.ts and
// this file is a thin wrapper.
//
// `ClaudeCliNotFoundError` is re-exported here as an alias for
// `LLMBackendUnavailableError` — same class, two names — so the
// ~10 existing `instanceof ClaudeCliNotFoundError` catch sites in
// the journal / chat-index / sources subsystems keep working
// unchanged. New code should prefer `LLMBackendUnavailableError`.

import { getActiveBackend } from "../../agent/backend/index.js";

// (systemPrompt, userPrompt) → raw model output as a string.
// The daily/optimization passes parse JSON out of the string
// themselves; this layer stays transport-only.
export type Summarize = (systemPrompt: string, userPrompt: string) => Promise<string>;

// Re-export under both names. Catch sites using either spelling
// land on the same class.
export { LLMBackendUnavailableError, LLMBackendUnavailableError as ClaudeCliNotFoundError } from "../../agent/backend/types.js";

// Default summarizer. Delegates to the active backend's text-output
// generate path. The backend's tuning module owns per-profile flags
// (timeout, model, budget cap, etc.); this file no longer has any
// Claude-CLI-specific knobs.
export const runClaudeCli: Summarize = async (systemPrompt, userPrompt) => {
  return getActiveBackend().generate({
    systemPrompt,
    userPrompt,
    profile: "journal-archivist",
  });
};
