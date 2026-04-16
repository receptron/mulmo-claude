// Server-sent events delivered by `POST /api/agent`. The frontend
// reads these off the SSE stream and dispatches into the active
// session's state.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { EVENT_TYPES } from "./events";

export interface SseToolCall {
  type: typeof EVENT_TYPES.toolCall;
  toolUseId: string;
  toolName: string;
  args: unknown;
}

export interface SseToolCallResult {
  type: typeof EVENT_TYPES.toolCallResult;
  toolUseId: string;
  content: string;
}

export interface SseStatus {
  type: typeof EVENT_TYPES.status;
  message: string;
}

export interface SseSwitchRole {
  type: typeof EVENT_TYPES.switchRole;
  roleId: string;
}

export interface SseText {
  type: typeof EVENT_TYPES.text;
  message: string;
  source?: "user" | "assistant";
}

export interface SseToolResult {
  type: typeof EVENT_TYPES.toolResult;
  result: ToolResultComplete;
}

export interface SseRolesUpdated {
  type: typeof EVENT_TYPES.rolesUpdated;
}

export interface SseError {
  type: typeof EVENT_TYPES.error;
  message: string;
}

/** Sent on the session channel when the agent run finishes. */
export interface SseSessionFinished {
  type: typeof EVENT_TYPES.sessionFinished;
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
