// Backend factory. Today there is only ClaudeCodeBackend; future
// backends (OpenAI, Ollama native, Gemini) are selected here based on
// env / settings. Callers go through getActiveBackend() rather than
// importing a concrete adapter so adding a backend doesn't require
// touching every call site.

import { claudeCodeBackend } from "./claude-code.js";
import type { LLMBackend } from "./types.js";

export type { AgentInput, BackendCapabilities, LLMBackend } from "./types.js";

export function getActiveBackend(): LLMBackend {
  return claudeCodeBackend;
}
