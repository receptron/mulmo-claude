// Single source of truth for the event / entry `type` discriminators
// used across SSE streams, pub-sub session channels, and on-disk
// chat jsonl entries. Before this module, these strings were
// baked into ~200 inline literals — renaming any of them was a
// grep-and-edit across frontend + backend + tests, and a typo
// would silently misroute events without any typecheck failure.
//
// Part of the scatter-cleanup work tracked in #289. This file is
// safe to import from both the Vue frontend and the Node server
// since it's plain TypeScript with no runtime dependencies.

// The `as const` assertion makes each value its own literal type so
// `EVENT_TYPES.toolResult` has type `"tool_result"`, not `string`.
// That preserves TypeScript's discriminated-union narrowing at call
// sites that check `event.type === EVENT_TYPES.toolResult`.
export const EVENT_TYPES = {
  // Agent-run lifecycle + streaming payloads (SSE channel).
  status: "status",
  text: "text",
  toolCall: "tool_call",
  toolCallResult: "tool_call_result",
  toolResult: "tool_result",
  switchRole: "switch_role",
  error: "error",
  claudeSessionId: "claude_session_id",
  sessionFinished: "session_finished",
  // Legacy / on-disk only — chat jsonl used to inline metadata as a
  // first-line entry. New sessions store this in `<id>.json` instead
  // but the parser still has to skip stale entries in old files.
  sessionMeta: "session_meta",
  // Broadcast when the Role Manager creates / edits / deletes a
  // custom role, so every open tab can refresh its role palette.
  rolesUpdated: "roles_updated",
} as const;

// Union of every event-type string defined above. Use this as the
// type of the discriminator field on event / entry records so the
// constant and the union stay in lockstep.
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
