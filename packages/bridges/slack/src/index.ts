#!/usr/bin/env node
// @mulmobridge/slack — Slack bridge for MulmoClaude.
//
// Uses Slack Socket Mode (no public URL needed).
//
// Required env vars:
//   SLACK_BOT_TOKEN     — xoxb-... (Bot User OAuth Token)
//   SLACK_APP_TOKEN     — xapp-... (App-Level Token with connections:write)
//
// Optional:
//   SLACK_ALLOWED_CHANNELS     — CSV of channel IDs (empty = allow all)
//   SLACK_SESSION_GRANULARITY  — "channel" (default) | "thread" | "auto"
//                                Controls how a single Slack channel is split
//                                into MulmoClaude sessions. See README.md.
//   MULMOCLAUDE_API_URL        — default http://localhost:3001
//   MULMOCLAUDE_AUTH_TOKEN     — bearer token (or read from workspace)

import "dotenv/config";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { createBridgeClient } from "@mulmobridge/client";
import { buildExternalChatId, effectiveThreadTs, parseExternalChatId, parseGranularity } from "./sessionId.js";
import { redactUser } from "./redactUser.js";

const TRANSPORT_ID = "slack";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
if (!botToken || !appToken) {
  console.error("SLACK_BOT_TOKEN and SLACK_APP_TOKEN are required.\n" + "See README for setup instructions.");
  process.exit(1);
}

const allowedChannels = new Set(
  (process.env.SLACK_ALLOWED_CHANNELS ?? "")
    .split(",")
    .map((channelId) => channelId.trim())
    .filter(Boolean),
);
const allowAll = allowedChannels.size === 0;

const granularity = (() => {
  try {
    return parseGranularity(process.env.SLACK_SESSION_GRANULARITY);
  } catch (err) {
    console.error(`[slack] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
})();

const web = new WebClient(botToken);
const socketMode = new SocketModeClient({ appToken });

const client = createBridgeClient({ transportId: TRANSPORT_ID });

// Resolve the bot's own user ID so we can ignore our own messages
let botUserId: string | null = null;

client.onPush((pushEvent) => {
  const { channel, threadTs } = parseExternalChatId(pushEvent.chatId);
  web.chat
    .postMessage({
      channel,
      text: pushEvent.message,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    })
    .catch((err) => console.error(`[slack] push send failed: ${err}`));
});

socketMode.on("message", async ({ event, ack }) => {
  await ack();

  // Ignore bot's own messages, message_changed, etc.
  if (event.subtype) return;
  if (event.bot_id) return;
  if (botUserId && event.user === botUserId) return;

  const channelId: string = event.channel;
  const threadTs = effectiveThreadTs(event, granularity);
  const text: string = event.text ?? "";
  if (!text.trim()) return;

  if (!allowAll && !allowedChannels.has(channelId)) {
    console.log(`[slack] denied channel=${channelId}`);
    return;
  }

  const externalChatId = buildExternalChatId(channelId, threadTs, granularity);
  console.log(`[slack] message channel=${channelId} thread_ts=${threadTs ?? "-"} session=${externalChatId} user=${redactUser(event.user)} len=${text.length}`);

  try {
    const ackResult = await client.send(externalChatId, text);
    if (ackResult.ok) {
      await sendChunked(channelId, threadTs, ackResult.reply ?? "");
    } else {
      const status = ackResult.status ? ` (${ackResult.status})` : "";
      await web.chat
        .postMessage({
          channel: channelId,
          text: `Error${status}: ${ackResult.error ?? "unknown"}`,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        })
        .catch((err) => console.error(`[slack] error notification failed: ${err}`));
    }
  } catch (err) {
    console.error(`[slack] message handling failed: ${err}`);
  }
});

async function sendChunked(channel: string, threadTs: string | undefined, text: string): Promise<void> {
  // Slack's max message length is ~40,000 chars but we chunk at 4000
  // for readability (matching Telegram's approach).
  const MAX = 4000;
  const baseArgs = threadTs ? { channel, thread_ts: threadTs } : { channel };
  if (text.length === 0) {
    await web.chat.postMessage({ ...baseArgs, text: "(empty reply)" });
    return;
  }
  for (let i = 0; i < text.length; i += MAX) {
    await web.chat.postMessage({
      ...baseArgs,
      text: text.slice(i, i + MAX),
    });
  }
}

async function main(): Promise<void> {
  // Get bot user ID
  const authResult = await web.auth.test();
  const rawUserId = authResult.user_id;
  botUserId = typeof rawUserId === "string" ? rawUserId : null;

  console.log("MulmoClaude Slack bridge");
  console.log(`Channels: ${allowAll ? "(all)" : [...allowedChannels].join(", ")}`);
  console.log(`Session granularity: ${granularity}`);

  await socketMode.start();
  console.log("Connected to Slack (Socket Mode).");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
