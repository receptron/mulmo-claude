// Pure helpers for the agent's tool-call history manipulation
// pulled out of `src/App.vue#sendMessage`. Each function is
// single-purpose, testable in isolation, and side-effect-free.
//
// Extracted as part of the cognitive-complexity refactor tracked
// in #175.

import type { ToolCallHistoryItem } from "../../types/toolCallHistory";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

// When an SSE `tool_call_result` event arrives, the server tells
// us which tool call it belongs to via `toolUseId`. Find the most
// recent matching history entry that's still **pending** (no
// result, no error) and return it so the caller can attach the
// payload.
//
// Newest-first: scanning in reverse is intentional — two calls to
// the same tool within one run would otherwise attach the new
// result to the earlier entry. Reverse scan always picks the
// freshest pending entry, matching the server's LIFO ordering.
//
// Returns `undefined` when no pending call matches (race / retry /
// late-arriving event). Pure.
export function findPendingToolCall(
  history: readonly ToolCallHistoryItem[],
  toolUseId: string,
): ToolCallHistoryItem | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (
      entry.toolUseId === toolUseId &&
      entry.result === undefined &&
      entry.error === undefined
    ) {
      return entry;
    }
  }
  return undefined;
}

// Decide whether a newly-arrived assistant text message should
// become the selected canvas result. Rule: yes, iff no plugin
// tool result has landed during this run. A plugin result — e.g.
// an image, a todo list update — is visually richer than a bare
// text response and should stay selected once emitted.
//
// `runStartIndex` is the index into `toolResults` at which the
// current run's outputs begin. Results before that index belong
// to previous turns and don't count.
//
// Pure — returns a boolean for the caller to act on.
export function shouldSelectAssistantText(
  toolResults: readonly ToolResultComplete[],
  runStartIndex: number,
): boolean {
  for (let i = runStartIndex; i < toolResults.length; i++) {
    if (toolResults[i].toolName !== "text-response") return false;
  }
  return true;
}
