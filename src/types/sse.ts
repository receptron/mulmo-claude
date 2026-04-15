// Server-sent events delivered by `POST /api/agent`. The frontend
// reads these off the SSE stream and dispatches into the active
// session's state.

import type { ToolResultComplete } from "gui-chat-protocol/vue";

export interface SseToolCall {
  type: "tool_call";
  toolUseId: string;
  toolName: string;
  args: unknown;
}

export interface SseToolCallResult {
  type: "tool_call_result";
  toolUseId: string;
  content: string;
}

export interface SseStatus {
  type: "status";
  message: string;
}

export interface SseSwitchRole {
  type: "switch_role";
  roleId: string;
}

export interface SseText {
  type: "text";
  message: string;
  source?: "user" | "assistant";
}

export interface SseToolResult {
  type: "tool_result";
  result: ToolResultComplete;
}

export interface SseRolesUpdated {
  type: "roles_updated";
}

export interface SseError {
  type: "error";
  message: string;
}

/** Sent on the session channel when the agent run finishes. */
export interface SseSessionFinished {
  type: "session_finished";
}

export type SseEvent =
  | SseToolCall
  | SseToolCallResult
  | SseStatus
  | SseSwitchRole
  | SseText
  | SseToolResult
  | SseRolesUpdated
  | SseError
  | SseSessionFinished;
