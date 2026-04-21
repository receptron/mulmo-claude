// Deduplicate consecutive tool results that represent "full-state
// refreshes" (e.g. a wiki page re-render after an edit). When two
// adjacent results have the same toolName and both carry
// `updating: true`, only the later one is kept. Text-response
// cards are never collapsed — each is a distinct message.

import type { ToolResultComplete } from "gui-chat-protocol/vue";

export function deduplicateResults(all: ToolResultComplete[]): ToolResultComplete[] {
  return all.filter((result, i) => {
    if (result.toolName === "text-response") return true;
    const next = all[i + 1];
    if (!next) return true;
    if (next.toolName !== result.toolName) return true;
    return !(result.updating === true && next.updating === true);
  });
}
