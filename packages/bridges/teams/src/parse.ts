// Pure parsing helpers for the Teams bridge.

import type { Activity } from "botbuilder";

export interface IncomingTeamsMessage {
  senderId: string;
  chatId: string;
  text: string;
}

/**
 * Pull the senderId / chatId / text triple out of a Teams Activity,
 * or return null when the activity isn't an actionable user message
 * (non-message type, blank body, missing identifiers, …).
 *
 * Pure — no I/O, no allowlist check. The orchestration layer in
 * index.ts decides what to do with the parsed result.
 */
export function extractIncomingMessage(activity: Activity): IncomingTeamsMessage | null {
  if (activity.type !== "message") return null;
  const senderId = activity.from?.aadObjectId ?? activity.from?.id ?? "";
  const chatId = activity.conversation?.id ?? "";
  const text = (activity.text ?? "").trim();
  if (!senderId || !chatId || !text) return null;
  return { senderId, chatId, text };
}
