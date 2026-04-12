// Server-Sent-Event line parsing for the agent SSE stream.
//
// Extracted from `src/App.vue#sendMessage` as part of the
// cognitive-complexity refactor tracked in #175. The pure-parsing
// pieces were the biggest contributor to that function's CC score
// (the outer while-loop + inner for-loop + JSON.parse + type
// dispatch, all nested). Pulling the pre-dispatch half — buffer
// management + line splitting + JSON decode — into a named helper
// drops the sendMessage score substantially while giving us a
// clean surface to table-test.

import type { SseEvent } from "../../types/sse";

export interface ParsedSseChunk {
  /** Complete SSE events decoded from the buffer + new chunk. */
  events: SseEvent[];
  /**
   * Text that wasn't a full line yet — hand it back into the next
   * call as the `buffer` parameter. Empty string when the stream
   * naturally broke on a newline.
   */
  remaining: string;
}

// Walk a chunk of decoded SSE text appended to an existing buffer
// and extract every fully-delivered event line. Partial trailing
// text is returned as `remaining` so the caller can prepend it to
// the next read. Silently skips:
//
//   - blank / keep-alive lines (no `data: ` prefix)
//   - lines whose payload fails `JSON.parse`
//   - lines whose payload parses but isn't a recognised event
//     shape (`type` missing or unknown) — surfacing those would
//     be noise, since the server is the only producer and new
//     event types roll out as additive features
//
// The function does NO I/O and never throws. Pure.
export function parseSSEChunk(
  buffer: string,
  chunkText: string,
): ParsedSseChunk {
  const combined = buffer + chunkText;
  const lines = combined.split("\n");
  const remaining = lines.pop() ?? "";
  const events: SseEvent[] = [];
  for (const line of lines) {
    const event = decodeSSELine(line);
    if (event !== null) events.push(event);
  }
  return { events, remaining };
}

// Decode a single SSE `data: ...` line into an event, or null to
// signal "skip". Exported so tests can exercise each reject-reason
// path independently of the buffer state.
export function decodeSSELine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice("data: ".length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isSseEvent(parsed)) return null;
  return parsed;
}

// Runtime shape check for an SSE event. Only validates the
// discriminator (`type`) — the downstream dispatch handles each
// shape's specific fields. If we ever add structural validation it
// should live here, not scatter across every consumer.
function isSseEvent(value: unknown): value is SseEvent {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return false;
  return (
    type === "tool_call" ||
    type === "tool_call_result" ||
    type === "status" ||
    type === "switch_role" ||
    type === "text" ||
    type === "tool_result" ||
    type === "roles_updated" ||
    type === "error"
  );
}
