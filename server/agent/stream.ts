import { EVENT_TYPES } from "../../src/types/events.js";

export type AgentEvent =
  | { type: typeof EVENT_TYPES.status; message: string }
  | { type: typeof EVENT_TYPES.text; message: string }
  | { type: typeof EVENT_TYPES.toolResult; result: unknown }
  | { type: typeof EVENT_TYPES.switchRole; roleId: string }
  | { type: typeof EVENT_TYPES.error; message: string }
  | {
      type: typeof EVENT_TYPES.toolCall;
      toolUseId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: typeof EVENT_TYPES.toolCallResult;
      toolUseId: string;
      content: string;
    }
  | { type: typeof EVENT_TYPES.claudeSessionId; id: string };

export interface ClaudeContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  /** Text content — present in `text` type blocks. */
  text?: string;
}

export interface ClaudeMessage {
  content?: ClaudeContentBlock[];
}

export type ClaudeStreamEvent =
  | { type: "assistant"; message: ClaudeMessage }
  | { type: "user"; message: ClaudeMessage }
  | { type: "result"; result: string; session_id?: string };

// stream_event sub-types emitted when --include-partial-messages is on.
export interface StreamEventDelta {
  type: "content_block_delta";
  index: number;
  delta: { type: string; text?: string };
}

export interface RawStreamEvent {
  type: string;
  message?: ClaudeMessage;
  result?: string;
  session_id?: string;
  /** Present when type === "stream_event". Carries partial text
   *  deltas for real-time streaming. */
  event?: StreamEventDelta | { type: string };
}

export function blockToEvent(block: ClaudeContentBlock): AgentEvent | null {
  if (block.type === "text" && typeof block.text === "string") {
    return {
      type: EVENT_TYPES.text,
      message: block.text,
    };
  }
  if (block.type === "tool_use" && block.id && block.name) {
    return {
      type: EVENT_TYPES.toolCall,
      toolUseId: block.id,
      toolName: block.name,
      args: block.input,
    };
  }
  if (block.type === "tool_result" && block.tool_use_id) {
    const raw = block.content;
    const content =
      typeof raw === "string"
        ? raw
        : raw === undefined
          ? ""
          : JSON.stringify(raw);
    return {
      type: EVENT_TYPES.toolCallResult,
      toolUseId: block.tool_use_id,
      content,
    };
  }
  return null;
}

// Stateful parser that tracks whether text was already emitted via
// assistant content blocks. When it has, the `result` event's text
// is a duplicate and must be suppressed to avoid showing the
// response twice.
// Extract a text delta from a stream_event, or null if the event
// isn't a text delta. Keeps the main parse function under the
// cognitive-complexity cap.
function extractTextDelta(event: RawStreamEvent): string | null {
  if (event.type !== "stream_event" || !event.event) return null;
  const inner = event.event;
  if (
    inner.type !== "content_block_delta" ||
    !("delta" in inner) ||
    inner.delta.type !== "text_delta" ||
    typeof inner.delta.text !== "string"
  ) {
    return null;
  }
  return inner.delta.text;
}

export function createStreamParser(): {
  parse: (event: RawStreamEvent) => AgentEvent[];
} {
  let textStreamedFromBlocks = false;

  function parse(event: RawStreamEvent): AgentEvent[] {
    // Handle streaming text deltas from --include-partial-messages.
    const delta = extractTextDelta(event);
    if (delta !== null) {
      textStreamedFromBlocks = true;
      return [{ type: EVENT_TYPES.text, message: delta }];
    }
    if (event.type === "stream_event") return [];

    if (event.type === "result") {
      const events: AgentEvent[] = [];
      // Only emit the result text if no text was already streamed
      // via assistant content blocks. This prevents duplication:
      // Claude CLI emits the same text in both `assistant` blocks
      // (incremental) and the final `result` (complete).
      if (!textStreamedFromBlocks && event.result) {
        events.push({ type: EVENT_TYPES.text, message: event.result });
      }
      if (event.session_id) {
        events.push({
          type: EVENT_TYPES.claudeSessionId,
          id: event.session_id,
        });
      }
      // Reset for the next turn in a resumed session.
      textStreamedFromBlocks = false;
      return events;
    }

    if (event.type !== "assistant" && event.type !== "user") {
      return [];
    }

    const content = event.message?.content;
    const blockEvents = Array.isArray(content)
      ? content.map(blockToEvent).filter((e): e is AgentEvent => e !== null)
      : [];

    // Track whether any text block was emitted so we can suppress
    // the duplicate in the `result` event.
    if (blockEvents.some((e) => e.type === EVENT_TYPES.text)) {
      textStreamedFromBlocks = true;
    }

    if (event.type === "assistant") {
      // When text was already streamed via deltas, the `assistant`
      // event's text blocks are duplicates — filter them out so the
      // UI doesn't double-render or create a second card.
      const filtered = textStreamedFromBlocks
        ? blockEvents.filter((e) => e.type !== EVENT_TYPES.text)
        : blockEvents;
      return [
        { type: EVENT_TYPES.status, message: "Thinking..." },
        ...filtered,
      ];
    }
    return blockEvents;
  }

  return { parse };
}

// Stateless convenience — used by tests and one-off parsing.
// For the agent loop, use createStreamParser() to get dedup.
export function parseStreamEvent(event: RawStreamEvent): AgentEvent[] {
  if (event.type === "result" && event.result) {
    const events: AgentEvent[] = [
      { type: EVENT_TYPES.text, message: event.result },
    ];
    if (event.session_id) {
      events.push({
        type: EVENT_TYPES.claudeSessionId,
        id: event.session_id,
      });
    }
    return events;
  }

  if (event.type !== "assistant" && event.type !== "user") {
    return [];
  }

  const content = event.message?.content;
  const blockEvents = Array.isArray(content)
    ? content.map(blockToEvent).filter((e): e is AgentEvent => e !== null)
    : [];

  if (event.type === "assistant") {
    return [
      { type: EVENT_TYPES.status, message: "Thinking..." },
      ...blockEvents,
    ];
  }
  return blockEvents;
}
