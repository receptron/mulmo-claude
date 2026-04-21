// Pure session-mutation helpers extracted from App.vue.
// These operate on ActiveSession objects directly — no Vue
// reactivity, no imports from the component.

import { v4 as uuidv4 } from "uuid";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ActiveSession } from "../../types/session";
import { makeTextResult } from "../tools/result";

/** Push a result and record its timestamp in one place. */
export function pushResult(
  session: ActiveSession,
  result: ToolResultComplete,
): void {
  session.toolResults.push(result);
  session.resultTimestamps.set(result.uuid, Date.now());
}

/** Surface a server/transport error as a visible card in the session. */
export function pushErrorMessage(
  session: ActiveSession,
  message: string,
): void {
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
export function appendToLastAssistantText(
  session: ActiveSession,
  text: string,
): boolean {
  const last = session.toolResults[session.toolResults.length - 1];
  const lastData = last?.data as { role?: string; text?: string } | undefined;
  if (last?.toolName !== "text-response" || lastData?.role !== "assistant") {
    return false;
  }
  lastData.text = (lastData.text ?? "") + text;
  last.message = (last.message ?? "") + text;
  return true;
}
