#!/usr/bin/env node
// @mulmobridge/discord — Discord bridge for MulmoClaude.
//
// Required env vars:
//   DISCORD_BOT_TOKEN      — Bot token from Discord Developer Portal
//
// Optional:
//   DISCORD_ALLOWED_CHANNELS — CSV of channel IDs (empty = allow all)
//   MULMOCLAUDE_API_URL      — default http://localhost:3001
//   MULMOCLAUDE_AUTH_TOKEN   — bearer token (or read from workspace)

import "dotenv/config";
import { Client, GatewayIntentBits, Partials, type Message } from "discord.js";
import { createBridgeClient } from "@mulmobridge/client";

const TRANSPORT_ID = "discord";
const MAX_DISCORD_LENGTH = 2000;

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error(
    "DISCORD_BOT_TOKEN is required.\nSee README for setup instructions.",
  );
  process.exit(1);
}

const allowedChannels = new Set(
  (process.env.DISCORD_ALLOWED_CHANNELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const allowAll = allowedChannels.size === 0;

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  // Partials.Channel is required to receive DM messageCreate events —
  // DM channels are not cached by default in discord.js v14.
  partials: [Partials.Channel],
});

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush(async (ev) => {
  try {
    const channel =
      discord.channels.cache.get(ev.chatId) ??
      (await discord.channels.fetch(ev.chatId).catch(() => null));
    if (channel?.isTextBased() && "send" in channel) {
      const sendable = channel as { send: (t: string) => Promise<unknown> };
      await sendChunkedToSendable(sendable, ev.message);
    } else {
      console.warn(
        `[discord] push: channel ${ev.chatId} not found or not text-based`,
      );
    }
  } catch (err) {
    console.error(`[discord] push send failed: ${err}`);
  }
});

discord.on("messageCreate", async (msg: Message) => {
  if (msg.author.bot) return;
  const channelId = msg.channelId;
  const text = msg.content.trim();
  if (!text) return;
  if (!allowAll && !allowedChannels.has(channelId)) return;

  console.log(
    `[discord] message channel=${channelId} user=${msg.author.tag} len=${text.length}`,
  );

  try {
    const ack = await mulmo.send(channelId, text);
    if (ack.ok) {
      await sendChunked(msg, ack.reply ?? "");
    } else {
      const status = ack.status ? ` (${ack.status})` : "";
      await msg.reply(`Error${status}: ${ack.error ?? "unknown"}`);
    }
  } catch (err) {
    console.error(`[discord] message handling failed: ${err}`);
  }
});

async function sendChunked(msg: Message, text: string): Promise<void> {
  if (text.length === 0) {
    await msg.reply("(empty reply)");
    return;
  }
  for (let i = 0; i < text.length; i += MAX_DISCORD_LENGTH) {
    const chunk = text.slice(i, i + MAX_DISCORD_LENGTH);
    if (i === 0) {
      await msg.reply(chunk);
    } else if ("send" in msg.channel) {
      await (msg.channel as { send: (t: string) => Promise<unknown> }).send(
        chunk,
      );
    }
  }
}

async function sendChunkedToSendable(
  channel: { send: (t: string) => Promise<unknown> },
  text: string,
): Promise<void> {
  const content = text.length === 0 ? "(empty reply)" : text;
  for (let i = 0; i < content.length; i += MAX_DISCORD_LENGTH) {
    await channel.send(content.slice(i, i + MAX_DISCORD_LENGTH));
  }
}

discord.once("ready", () => {
  console.log("MulmoClaude Discord bridge");
  console.log(`Logged in as ${discord.user?.tag}`);
  console.log(
    `Channels: ${allowAll ? "(all)" : [...allowedChannels].join(", ")}`,
  );
});

discord.login(token).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
