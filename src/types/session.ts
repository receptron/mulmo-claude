// Per-session client-side state and the on-disk envelope shapes
// returned by the server's session routes.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { EVENT_TYPES, type PendingGeneration } from "./events";
import type { ToolCallHistoryItem } from "./toolCallHistory";

// ── Session origin (#486) ───────────────────────────────────

export const SESSION_ORIGINS = {
  human: "human",
  scheduler: "scheduler",
  skill: "skill",
  bridge: "bridge",
} as const;

export type SessionOrigin =
  (typeof SESSION_ORIGINS)[keyof typeof SESSION_ORIGINS];

const VALID_ORIGINS: ReadonlySet<string> = new Set(
  Object.values(SESSION_ORIGINS),
);

export function isSessionOrigin(value: unknown): value is SessionOrigin {
  return typeof value === "string" && VALID_ORIGINS.has(value);
}

// Server `/api/sessions` summary. Optional `summary` and `keywords`
// are populated by the chat indexer (#123) when present.
//
// `updatedAt` is the most recent activity timestamp — taken from the
// jsonl file's mtime on the server side and bumped whenever the
// client appends a message in-memory. Used for the "most recently
// touched" sort order in the session history sidebar (users expect
// active sessions to float to the top, not to stay pinned in
// creation order).
export interface SessionSummary {
  id: string;
  roleId: string;
  startedAt: string;
  updatedAt: string;
  preview: string;
  summary?: string;
  keywords?: string[];
  /** Where this session originated. Missing = "human" (backward compat). */
  origin?: SessionOrigin;
  // Live state from the server session store (present when the
  // session has an active in-memory entry on the server).
  isRunning?: boolean;
  hasUnread?: boolean;
  statusMessage?: string;
}

// One line of a session jsonl as returned by `/api/sessions/:id`.
// Generic envelope; concrete narrowed shapes below.
export interface SessionEntry {
  type?: string;
  source?: string;
  roleId?: string;
  message?: string;
  result?: ToolResultComplete;
}

export interface TextEntry extends SessionEntry {
  source: "user" | "assistant";
  type: typeof EVENT_TYPES.text;
  message: string;
}

export interface ToolResultEntry extends SessionEntry {
  source: "tool";
  type: typeof EVENT_TYPES.toolResult;
  result: ToolResultComplete;
}

export const isTextEntry = (e: SessionEntry): e is TextEntry =>
  (e.source === "user" || e.source === "assistant") &&
  e.type === EVENT_TYPES.text &&
  typeof e.message === "string";

export const isToolResultEntry = (e: SessionEntry): e is ToolResultEntry =>
  e.source === "tool" &&
  e.type === EVENT_TYPES.toolResult &&
  e.result !== undefined;

// In-memory session held in `sessionMap`. PR #88 introduced this so
// multiple chats can run concurrently — `id` matches the `chatSessionId`
// the server uses for the on-disk jsonl.
export interface ActiveSession {
  id: string;
  roleId: string;
  toolResults: ToolResultComplete[];
  /** UUID → epoch ms. Recorded when each result is added to the
   *  session — either from a real-time pubsub event or from
   *  loading a saved session. For saved sessions, the session's
   *  `startedAt` is used as a baseline (individual per-entry
   *  timestamps aren't persisted in the JSONL yet). */
  resultTimestamps: Map<string, number>;
  isRunning: boolean;
  statusMessage: string;
  toolCallHistory: ToolCallHistoryItem[];
  selectedResultUuid: string | null;
  hasUnread: boolean;
  startedAt: string;
  // Bumped whenever the user sends a new message in this session.
  // Used by `mergedSessions` to sort the sidebar history list by
  // "most recently touched" rather than "created first".
  updatedAt: string;
  // Index into `toolResults` at which the current run's outputs begin.
  // Rewritten on every user turn by `beginUserTurn`; consumed by
  // `shouldSelectAssistantText` to decide whether a trailing text
  // reply should become the selected canvas result. Lives on the
  // session (not on the subscription closure) so updates on turn N+1
  // are visible to the reused subscription callback.
  runStartIndex: number;
  /**
   * In-flight background generations triggered by a plugin view (e.g.
   * MulmoScript image/audio/movie renders). Keyed by
   * `generationKey(kind, filePath, key)` (opaque identity, not parsed
   * back); the value carries the decomposed (kind, filePath, key) so
   * views read those fields directly. Empty map = no background work.
   */
  pendingGenerations: Record<string, PendingGeneration>;
}
