// Shared reply formatting for bridges.
//
// Every bridge converts a `MessageAck` from `BridgeClient.send()`
// into a single string to send back over its native transport. The
// happy-path / error-path shape is identical across bridges
// (LINE / Slack / Teams / Mastodon / XMPP all do the same thing
// modulo the send call), so the formatting belongs here.

import type { MessageAck } from "./client.js";

/**
 * Format a `MessageAck` as a single user-facing string.
 *
 * - `ok` ack → `reply` content (or empty string if absent).
 * - Failed ack → `"Error[ (status)]: <error or 'unknown'>"`.
 */
export function formatAckReply(ack: MessageAck): string {
  if (ack.ok) return ack.reply ?? "";
  const status = ack.status ? ` (${ack.status})` : "";
  return `Error${status}: ${ack.error ?? "unknown"}`;
}
