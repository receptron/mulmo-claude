// Pure dispatcher: maps an SseEvent into mutations on an ActiveSession
// via the AgentEventContext adapter. No Vue refs, no component scope.

import type { ActiveSession } from "../../types/session";
import type { SseEvent } from "../../types/sse";
import { EVENT_TYPES, generationKey } from "../../types/events";
import { findPendingToolCall, toToolCallEntry } from "./toolCalls";
import { pushErrorMessage, applyTextEvent, applyToolResultToSession } from "../session/sessionHelpers";
import { isSidebarVisible } from "../tools/sidebarVisibleApp";

export interface AgentEventContext {
  session: ActiveSession;
  refreshRoles: () => Promise<void>;
  scrollSidebarToBottom: () => void;
  onGenerationsDrained: () => void;
}

export async function applyAgentEvent(event: SseEvent, ctx: AgentEventContext): Promise<void> {
  const { session } = ctx;
  switch (event.type) {
    case EVENT_TYPES.toolCall:
      session.toolCallHistory.push(toToolCallEntry(event));
      ctx.scrollSidebarToBottom();
      return;
    case EVENT_TYPES.toolCallResult: {
      const entry = findPendingToolCall(session.toolCallHistory, event.toolUseId);
      if (entry) entry.result = event.content;
      ctx.scrollSidebarToBottom();
      return;
    }
    case EVENT_TYPES.status:
      session.statusMessage = event.message;
      return;
    case EVENT_TYPES.rolesUpdated:
      await ctx.refreshRoles();
      return;
    case EVENT_TYPES.text:
      applyTextEvent(session, event.message, event.source ?? "assistant", event.attachments);
      return;
    case EVENT_TYPES.toolResult:
      // Skip auto-select for sidebar-hidden results; otherwise the
      // user's selection silently jumps to a card they can't see.
      applyToolResultToSession(session, event.result, isSidebarVisible);
      return;
    case EVENT_TYPES.error:
      console.error("[agent] error event:", event.message);
      pushErrorMessage(session, event.message);
      return;
    case EVENT_TYPES.sessionFinished:
      return;
    case EVENT_TYPES.generationStarted: {
      const mapKey = generationKey(event.kind, event.filePath, event.key);
      session.pendingGenerations[mapKey] = {
        kind: event.kind,
        filePath: event.filePath,
        key: event.key,
      };
      return;
    }
    case EVENT_TYPES.generationFinished: {
      const mapKey = generationKey(event.kind, event.filePath, event.key);
      Reflect.deleteProperty(session.pendingGenerations, mapKey);
      if (Object.keys(session.pendingGenerations).length === 0) {
        ctx.onGenerationsDrained();
      }
    }
  }
}
