// Pure helpers for `ToolResultComplete` shapes used across the
// frontend. Kept dependency-free of Vue / DOM so they are trivially
// unit-testable from `node:test`.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { v4 as uuidv4 } from "uuid";
import { isRecord } from "../types";

// Type guard: a text-response entry whose `data.role` is `"user"`.
// Used by App.vue to find the first user message in a live session
// when building the merged history list.
export function isUserTextResponse(res: ToolResultComplete): boolean {
  if (res.toolName !== "text-response") return false;
  const { data } = res;
  if (!isRecord(data)) return false;
  return data.role === "user";
}

// Pull out the optional base64 image attached to a tool result, if
// any. Returns `undefined` for results that have no `data.imageData`
// or where it isn't a string.
export function extractImageData(result: ToolResultComplete | undefined): string | undefined {
  const data = result?.data;
  if (isRecord(data) && typeof data.imageData === "string") {
    return data.imageData;
  }
  return undefined;
}

// Build a synthetic text-response result for either a user or
// assistant turn. Used by sendMessage and the chat history UI.
// `attachments` is optional and only meaningful on user turns —
// they're the workspace paths the user attached for this message
// and surface as chips next to the bubble.
export function makeTextResult(text: string, role: "user" | "assistant", attachments?: readonly string[]): ToolResultComplete {
  const data: Record<string, unknown> = { text, role, transportKind: "text-rest" };
  if (attachments && attachments.length > 0) {
    data.attachments = [...attachments];
  }
  return {
    uuid: uuidv4(),
    toolName: "text-response",
    message: text,
    title: role === "user" ? "You" : "Assistant",
    data,
  };
}
