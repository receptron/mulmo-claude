// Event type constants for the agent SSE / socket.io wire protocol.
//
// These are the string values that appear in `{ type: "..." }` on
// every event flowing between the server and clients (both the Vue
// frontend and external bridges).

export const EVENT_TYPES = {
  status: "status",
  text: "text",
  toolCall: "tool_call",
  toolCallResult: "tool_call_result",
  toolResult: "tool_result",
  switchRole: "switch_role",
  error: "error",
  claudeSessionId: "claude_session_id",
  sessionFinished: "session_finished",
  sessionMeta: "session_meta",
  rolesUpdated: "roles_updated",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
