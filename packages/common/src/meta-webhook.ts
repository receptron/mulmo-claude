// Pure inbound-payload parsers for the Meta messaging platforms (Facebook
// Messenger, WhatsApp Cloud API). Both the Node/Express bridges and the
// Cloudflare Workers relay receive the same webhook JSON shapes and used to
// carry byte-identical copies of these extractors. They live here — a
// zero-dependency, no-node leaf — because that is the only tier both runtimes
// can import: no crypto, no fetch, no Node built-ins, just `isRecord`.
//
// Signature verification is deliberately NOT here: the bridges use node:crypto
// and the relay uses Web Crypto (`crypto.subtle`), so it cannot be shared.

import { isRecord, isUnknownArray } from "./index.js";

export interface MessengerTextMessage {
  senderId: string;
  text: string;
}

function parseMessengerEvent(event: unknown): MessengerTextMessage | null {
  if (!isRecord(event) || !isRecord(event.sender) || typeof event.sender.id !== "string") return null;
  if (!isRecord(event.message) || typeof event.message.text !== "string") return null;
  const text = event.message.text.trim();
  if (!text) return null;
  return { senderId: event.sender.id, text };
}

function messengerEventsOf(entry: unknown): unknown[] {
  return isRecord(entry) && isUnknownArray(entry.messaging) ? entry.messaging : [];
}

/** Every text message across all `entry[].messaging[]` events in a Messenger
 *  webhook body, skipping non-text / empty / malformed events. */
export function extractMessengerMessages(body: unknown): MessengerTextMessage[] {
  if (!isRecord(body) || !isUnknownArray(body.entry)) return [];
  return body.entry
    .flatMap(messengerEventsOf)
    .map(parseMessengerEvent)
    .filter((msg): msg is MessengerTextMessage => msg !== null);
}

export interface WhatsAppTextMessage {
  from: string;
  text: { body: string };
}

function parseWhatsAppMessage(msg: unknown): WhatsAppTextMessage | null {
  if (!isRecord(msg) || msg.type !== "text" || typeof msg.from !== "string") return null;
  if (!isRecord(msg.text) || typeof msg.text.body !== "string" || !msg.text.body.trim()) return null;
  return { from: msg.from, text: { body: msg.text.body } };
}

function whatsAppMessagesOf(change: unknown): unknown[] {
  if (!isRecord(change) || !isRecord(change.value) || !isUnknownArray(change.value.messages)) return [];
  return change.value.messages;
}

function whatsAppRawMessagesOf(entry: unknown): unknown[] {
  return isRecord(entry) && isUnknownArray(entry.changes) ? entry.changes.flatMap(whatsAppMessagesOf) : [];
}

/** Every inbound text message across all `entry[].changes[].value.messages[]`
 *  in a WhatsApp Cloud API webhook body, skipping non-text / malformed. */
export function extractWhatsAppMessages(body: unknown): WhatsAppTextMessage[] {
  if (!isRecord(body) || !isUnknownArray(body.entry)) return [];
  return body.entry
    .flatMap(whatsAppRawMessagesOf)
    .map(parseWhatsAppMessage)
    .filter((msg): msg is WhatsAppTextMessage => msg !== null);
}
