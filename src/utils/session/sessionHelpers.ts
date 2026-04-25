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

/** Append the user's message so it renders immediately. */
export function beginUserTurn(session: ActiveSession, message: string): void {
  session.updatedAt = new Date().toISOString();
  pushResult(session, makeTextResult(message, "user"));
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
 *  result when appropriate. */
export function applyTextEvent(session: ActiveSession, message: string, source: "user" | "assistant"): void {
  if (source === "user") {
    if (!isDuplicateUserText(session, message)) {
      pushResult(session, makeTextResult(message, "user"));
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

/** Undo the most recent user turn in a session: remove the last user
 *  message AND every result that the in-flight (or just-cancelled)
 *  agent run produced in response. Returns the text of the removed
 *  user message so the caller can restore it to the input form, or
 *  null when there's nothing to undo. Used by the Stop button (#821)
 *  so that "cancel" reads as "this turn never happened" — the user
 *  edits their draft and resends rather than seeing a half-finished
 *  exchange + a "what to continue?" reply. */
export function undoLastTurn(session: ActiveSession): { restoredText: string | null } {
  // beginUserTurn / applyTextEvent set runStartIndex to one past the
  // user message. So the user message lives at runStartIndex - 1.
  if (session.runStartIndex <= 0) return { restoredText: null };
  const userIndex = session.runStartIndex - 1;
  const userResult = session.toolResults[userIndex];
  const userData = userResult?.data as { role?: string; text?: string } | undefined;
  // Defensive: only undo when the boundary really points at a user
  // text result. If something else lives there (race / corrupt
  // state), bail rather than throw away unrelated events.
  if (userResult?.toolName !== "text-response" || userData?.role !== "user") {
    return { restoredText: null };
  }
  const restoredText = userData.text ?? null;
  const removed = session.toolResults.splice(userIndex);
  for (const item of removed) {
    session.resultTimestamps.delete(item.uuid);
  }
  // After splice, the turn boundary is the new (possibly shorter)
  // length. The previous turn (if any) is fully preserved.
  session.runStartIndex = session.toolResults.length;
  // Drop selection if it pointed inside the removed range.
  if (session.selectedResultUuid && removed.some((item) => item.uuid === session.selectedResultUuid)) {
    session.selectedResultUuid = null;
  }
  return { restoredText };
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
