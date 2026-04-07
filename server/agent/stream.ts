export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "text"; message: string }
  | { type: "tool_result"; result: unknown }
  | { type: "switch_role"; roleId: string }
  | { type: "error"; message: string }
  | { type: "tool_call"; toolUseId: string; toolName: string; args: unknown }
  | { type: "tool_call_result"; toolUseId: string; content: string }
  | { type: "claude_session_id"; id: string };

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
      type: "tool_call",
      toolUseId: block.id,
      toolName: block.name,
      args: block.input,
    };
  }
  if (block.type === "tool_result" && block.tool_use_id) {
    const raw = block.content;
    return {
      type: "tool_call_result",
      toolUseId: block.tool_use_id,
      content: typeof raw === "string" ? raw : JSON.stringify(raw),
    };
  }
  return null;
}

export function parseStreamEvent(event: RawStreamEvent): AgentEvent[] {
  if (event.type === "result" && event.result) {
    const events: AgentEvent[] = [{ type: "text", message: event.result }];
    if (event.session_id) {
      events.push({ type: "claude_session_id", id: event.session_id });
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
    return [{ type: "status", message: "Thinking..." }, ...blockEvents];
  }
  return blockEvents;
}
