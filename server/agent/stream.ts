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
}

export interface ClaudeMessage {
  content?: ClaudeContentBlock[];
}

export type ClaudeStreamEvent =
  | { type: "assistant"; message: ClaudeMessage }
  | { type: "user"; message: ClaudeMessage }
  | { type: "result"; result: string; session_id?: string };

export interface RawStreamEvent {
  type: string;
  message?: ClaudeMessage;
  result?: string;
  session_id?: string;
}

export function blockToEvent(block: ClaudeContentBlock): AgentEvent | null {
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
