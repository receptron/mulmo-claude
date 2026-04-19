// Pure helpers for `ToolResultComplete` shapes used across the
// frontend. Kept dependency-free of Vue / DOM so they are trivially
// unit-testable from `node:test`.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { v4 as uuidv4 } from "uuid";

// Type guard: a text-response entry whose `data.role` is `"user"`.
// Used by App.vue to find the first user message in a live session
// when building the merged history list.
export function isUserTextResponse(r: ToolResultComplete): boolean {
  if (r.toolName !== "text-response") return false;
  const data = r.data;
  if (typeof data !== "object" || data === null) return false;
  if (!("role" in data)) return false;
  return data.role === "user";
}

// Pull out the optional base64 image attached to a tool result, if
// any. Returns `undefined` for results that have no `data.imageData`
// or where it isn't a string.
export function extractImageData(
  result: ToolResultComplete | undefined,
): string | undefined {
  const data = result?.data;
  if (typeof data === "object" && data !== null && "imageData" in data) {
    return typeof data.imageData === "string" ? data.imageData : undefined;
  }
  return undefined;
}

// Build a synthetic text-response result for either a user or
// assistant turn. Used by sendMessage and the chat history UI.
export function makeTextResult(
  text: string,
  role: "user" | "assistant",
): ToolResultComplete {
  return {
    uuid: uuidv4(),
    toolName: "text-response",
    message: text,
    title: role === "user" ? "You" : "Assistant",
    data: { text, role, transportKind: "text-rest" },
  };
}
