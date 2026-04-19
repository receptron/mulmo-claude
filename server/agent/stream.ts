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

// Filter assistant block events: when deltas already streamed the
// text, remove text-type events to prevent duplication.
function filterAssistantBlocks(
  blockEvents: AgentEvent[],
  deltaStreamed: boolean,
): AgentEvent[] {
  return deltaStreamed
    ? blockEvents.filter((e) => e.type !== EVENT_TYPES.text)
    : blockEvents;
}

// Stateful parser that deduplicates text across the three stages
// Claude CLI emits: stream_event deltas → assistant content blocks
// → result full text. Uses two flags:
//
//   textStreamedFromDeltas — true once text_delta chunks have been
//     emitted from stream_event. Controls whether the full-text
//     `assistant` block is filtered as a duplicate of those chunks.
//
//   textEmitted — true once ANY text (delta or assistant block) has
//     been emitted, so the `result` event can suppress its duplicate
//     full-text copy. Prevents text loss when `assistant` arrives
//     without preceding `stream_event` deltas (short replies, CLI
//     version without `--include-partial-messages`, etc.).
export function createStreamParser(): {
  parse: (event: RawStreamEvent) => AgentEvent[];
} {
  let textStreamedFromDeltas = false;
  let textEmitted = false;

  function parse(event: RawStreamEvent): AgentEvent[] {
    // Handle streaming text deltas from --include-partial-messages.
    const delta = extractTextDelta(event);
    if (delta !== null) {
      textStreamedFromDeltas = true;
      textEmitted = true;
      return [{ type: EVENT_TYPES.text, message: delta }];
    }
    if (event.type === "stream_event") return [];

    if (event.type === "result") {
      const events: AgentEvent[] = [];
      if (!textEmitted && event.result) {
        events.push({ type: EVENT_TYPES.text, message: event.result });
      }
      if (event.session_id) {
        events.push({
          type: EVENT_TYPES.claudeSessionId,
          id: event.session_id,
        });
      }
      textStreamedFromDeltas = false;
      textEmitted = false;
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
      const filtered = filterAssistantBlocks(
        blockEvents,
        textStreamedFromDeltas,
      );
      if (filtered.some((e) => e.type === EVENT_TYPES.text)) {
        textEmitted = true;
      }
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
