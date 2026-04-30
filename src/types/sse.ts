// Server-sent events delivered by `POST /api/agent`. The frontend
// reads these off the SSE stream and dispatches into the active
// session's state.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { EVENT_TYPES, type GenerationKind } from "./events";

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

/**
 * Plugin-initiated background work (e.g. MulmoScript image / audio /
 * movie render) started. The client records this in
 * `session.pendingGenerations` so the sidebar busy indicator stays
 * lit even when the originating view isn't mounted.
 */
export interface SseGenerationStarted {
  type: typeof EVENT_TYPES.generationStarted;
  kind: GenerationKind;
  filePath: string;
  key: string;
}

/** Companion event to `SseGenerationStarted` — the work completed
 *  (or failed; `error` populated). */
export interface SseGenerationFinished {
  type: typeof EVENT_TYPES.generationFinished;
  kind: GenerationKind;
  filePath: string;
  key: string;
  error?: string;
}

export type SseEvent =
  | SseToolCall
  | SseToolCallResult
  | SseStatus
  | SseText
  | SseToolResult
  | SseRolesUpdated
  | SseError
  | SseSessionFinished
  | SseGenerationStarted
  | SseGenerationFinished;
