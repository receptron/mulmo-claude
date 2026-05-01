// Pure session-mutation helpers extracted from App.vue.
// These operate on ActiveSession objects directly — no Vue
// reactivity, no imports from the component.

import { v4 as uuidv4 } from "uuid";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ActiveSession } from "../../types/session";
import { makeTextResult } from "../tools/result";
import { shouldSelectAssistantText } from "../agent/toolCalls";

/** Push a result and record its timestamp in one place. */
export function pushResult(session: ActiveSession, result: ToolResultComplete): void {
  session.toolResults.push(result);
  session.resultTimestamps.set(result.uuid, Date.now());
}

/** Surface a server/transport error as a visible card in the session. */
export function pushErrorMessage(session: ActiveSession, message: string): void {
  const text = `[Error] ${message}`;
  const errorResult: ToolResultComplete = {
    uuid: uuidv4(),
    toolName: "text-response",
    message: text,
    title: "Error",
    data: { text, role: "assistant", transportKind: "text-rest" },
  };
  pushResult(session, errorResult);
  session.selectedResultUuid = errorResult.uuid;
}

/** Append the user's message so it renders immediately. `attachments`
 *  carries the workspace-relative paths the user attached for this
 *  turn (paste/drop/file-picker) so the chat bubble can render an
 *  icon / thumbnail chip alongside the text. */
export function beginUserTurn(session: ActiveSession, message: string, attachments?: readonly string[]): void {
  session.updatedAt = new Date().toISOString();
  pushResult(session, makeTextResult(message, "user", attachments));
  session.runStartIndex = session.toolResults.length;
}

/** Append text to the last assistant text-response if one exists.
 *  Returns true if appended, false if a new card is needed. */
export function appendToLastAssistantText(session: ActiveSession, text: string): boolean {
  const last = session.toolResults[session.toolResults.length - 1];
  const lastData = last?.data as { role?: string; text?: string } | undefined;
  if (last?.toolName !== "text-response" || lastData?.role !== "assistant") {
    return false;
  }
  lastData.text = (lastData.text ?? "") + text;
  last.message = (last.message ?? "") + text;
  return true;
}

/** Check if an incoming user text event is a duplicate of the last
 *  user message (sent by this tab via beginUserTurn). */
function isDuplicateUserText(session: ActiveSession, message: string): boolean {
  const last = session.toolResults[session.toolResults.length - 1];
  const lastData = last?.data as { role?: string; text?: string } | undefined;
  return last?.toolName === "text-response" && lastData?.role === "user" && lastData?.text === message;
}

/** Handle an incoming text event (user or assistant) from the
 *  agent's SSE/pubsub stream. Deduplicates user messages,
 *  streams assistant text into the last card, and selects the
 *  result when appropriate. `attachments` is forwarded for cross-tab
 *  user-text broadcasts so observing tabs render chips identically
 *  to the originating tab. */
export function applyTextEvent(session: ActiveSession, message: string, source: "user" | "assistant", attachments?: readonly string[]): void {
  if (source === "user") {
    if (!isDuplicateUserText(session, message)) {
      pushResult(session, makeTextResult(message, "user", attachments));
      session.runStartIndex = session.toolResults.length;
    }
    return;
  }
  if (appendToLastAssistantText(session, message)) return;
  const textResult = makeTextResult(message, "assistant");
  pushResult(session, textResult);
  if (shouldSelectAssistantText(session.toolResults, session.runStartIndex)) {
    session.selectedResultUuid = textResult.uuid;
  }
}

/** In-place update a result that was re-emitted by a plugin view
 *  (e.g. after the user edits a chart config). */
export function updateResult(session: ActiveSession, updatedResult: ToolResultComplete): void {
  const index = session.toolResults.findIndex((result) => result.uuid === updatedResult.uuid);
  if (index !== -1) {
    Object.assign(session.toolResults[index], updatedResult);
  }
}

/** Handle an incoming tool_result event: upsert into the session's
 *  result list. Selects the result only on insert; in-place updates
 *  preserve the user's current selection. */
export function applyToolResultToSession(session: ActiveSession, result: ToolResultComplete): void {
  const idx = session.toolResults.findIndex((existing) => existing.uuid === result.uuid);
  if (idx >= 0) {
    session.toolResults[idx] = result;
  } else {
    pushResult(session, result);
    session.selectedResultUuid = result.uuid;
  }
}
