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
  error: "error",
  claudeSessionId: "claude_session_id",
  sessionFinished: "session_finished",
  sessionMeta: "session_meta",
  rolesUpdated: "roles_updated",
  generationStarted: "generation_started",
  generationFinished: "generation_finished",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/**
 * Long-running async work originated by a plugin (MulmoScript etc.)
 * that continues past the initial HTTP response. The server publishes
 * a `generationStarted` event when the work begins and a
 * `generationFinished` event when it completes (or fails). Clients
 * track the in-flight set in `Session.pendingGenerations` so the UI
 * can keep a "busy" indicator lit across view navigation.
 */
export const GENERATION_KINDS = {
  beatImage: "beatImage",
  characterImage: "characterImage",
  beatAudio: "beatAudio",
  movie: "movie",
} as const;

export type GenerationKind = (typeof GENERATION_KINDS)[keyof typeof GENERATION_KINDS];

export interface GenerationEvent {
  type: "generation_started" | "generation_finished";
  kind: GenerationKind;
  /** MulmoScript file path — identifies the script the generation belongs to. */
  filePath: string;
  /** beatIndex (as string) for beat*, character key for characterImage, "" for movie. */
  key: string;
  /** Only set on generation_finished when the work failed. */
  error?: string;
}

/**
 * Decomposed view of a pending generation, stored as the *value* of
 * `pendingGenerations[mapKey]`. Consumers read these fields directly
 * rather than splitting the composite map key — filePath and user-
 * defined character keys can contain arbitrary characters, so
 * positional string parsing is unsafe.
 */
export interface PendingGeneration {
  kind: GenerationKind;
  filePath: string;
  key: string;
}

/**
 * Stable map-key for a generation: the triple (kind, filePath, key).
 * Separator is U+001F (UNIT SEPARATOR), a non-printable ASCII control
 * character that cannot appear in filePaths or user-entered keys —
 * this guarantees `generationKey(a) === generationKey(b)` iff a≡b,
 * unlike a human-visible delimiter that could collide.
 *
 * The returned string is used only as a map identity. Do NOT split it
 * to recover the fields — store the decomposed `PendingGeneration`
 * object as the map value instead.
 */
export function generationKey(kind: GenerationKind, filePath: string, key: string): string {
  return `${kind}\u001f${filePath}\u001f${key}`;
}
