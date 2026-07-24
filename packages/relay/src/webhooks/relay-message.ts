// The RelayMessage envelope factory. Every webhook platform built this same
// object literal (fresh id + timestamp wrapping the platform/sender/chat/text
// fields), so centralising it keeps the envelope shape defined once.

import type { Platform, RelayMessage } from "../types.js";
import { makeUuid } from "../utils/id.js";

export interface RelayMessageInput {
  platform: Platform;
  senderId: string;
  chatId: string;
  text: string;
  replyToken?: string;
}

export function makeRelayMessage(input: RelayMessageInput): RelayMessage {
  const message: RelayMessage = {
    id: makeUuid(),
    platform: input.platform,
    senderId: input.senderId,
    chatId: input.chatId,
    text: input.text,
    receivedAt: new Date().toISOString(),
  };
  // Only Teams carries a replyToken; omit the key entirely otherwise so the
  // forwarded JSON stays identical to the previous per-platform literals.
  if (input.replyToken !== undefined) message.replyToken = input.replyToken;
  return message;
}
