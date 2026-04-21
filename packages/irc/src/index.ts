#!/usr/bin/env node
// @mulmobridge/irc — IRC bridge for MulmoClaude.
//
// Required env vars:
//   IRC_SERVER     — e.g. irc.libera.chat
//   IRC_NICK       — bot nickname
//   IRC_CHANNELS   — CSV of channels to join (e.g. #mulmo,#test)
//
// Optional:
//   IRC_PORT       — default 6697 (TLS) or 6667 (plain)
//   IRC_TLS        — true/false (default: true)
//   IRC_PASSWORD   — NickServ or server password

import "dotenv/config";
// @ts-expect-error — irc-framework has no type declarations
import { Client as IrcClient } from "irc-framework";
import { createBridgeClient } from "@mulmobridge/client";

const TRANSPORT_ID = "irc";

const server = process.env.IRC_SERVER;
const nick = process.env.IRC_NICK;
const channelsStr = process.env.IRC_CHANNELS;
if (!server || !nick || !channelsStr) {
  console.error("IRC_SERVER, IRC_NICK, and IRC_CHANNELS are required.\n" + "See README for setup instructions.");
  process.exit(1);
}

const channels = channelsStr
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const useTls = (process.env.IRC_TLS ?? "true") !== "false";
const port = Number(process.env.IRC_PORT) || (useTls ? 6697 : 6667);
const password = process.env.IRC_PASSWORD;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((ev) => {
  // ev.chatId is the channel name
  irc.say(ev.chatId, ev.message);
});

const irc = new IrcClient();

irc.connect({
  host: server,
  port,
  nick,
  tls: useTls,
  password: password ?? undefined,
});

irc.on("registered", () => {
  console.log("MulmoClaude IRC bridge");
  console.log(`Connected to ${server}:${port} as ${nick}`);
  for (const ch of channels) {
    irc.join(ch);
    console.log(`Joined ${ch}`);
  }
});

irc.on("message", async (event: { target: string; nick: string; message: string }) => {
  // Ignore our own messages
  if (event.nick === nick) return;

  // IRC channel prefixes: #, &, +, ! (RFC 2812 §1.3)
  const isChannel = /^[#&+!]/.test(event.target);
  const chatId = isChannel ? event.target : event.nick;
  const text = event.message.trim();
  if (!text) return;

  // In channels, only respond when mentioned or prefixed with bot nick
  if (isChannel) {
    const mentionPrefix = `${nick}:`;
    const mentionPrefix2 = `${nick},`;
    if (!text.startsWith(mentionPrefix) && !text.startsWith(mentionPrefix2)) {
      return;
    }
    // Strip the mention prefix
    const stripped = text.slice(text.startsWith(mentionPrefix) ? mentionPrefix.length : mentionPrefix2.length).trim();
    if (!stripped) return;

    console.log(`[irc] message channel=${chatId} nick=${event.nick} len=${stripped.length}`);
    const ack = await mulmo.send(chatId, stripped);
    sendReply(chatId, ack);
    return;
  }

  // Private messages — respond directly
  console.log(`[irc] pm from=${event.nick} len=${text.length}`);
  const ack = await mulmo.send(chatId, text);
  sendReply(chatId, ack);
});

function sendReply(target: string, ack: { ok: boolean; reply?: string; error?: string; status?: number }): void {
  if (ack.ok) {
    const text = ack.reply ?? "(empty reply)";
    // IRC messages are max ~512 bytes per line. Chunk at 400 chars.
    const lines = text.split("\n");
    for (const line of lines) {
      for (let i = 0; i < line.length; i += 400) {
        irc.say(target, line.slice(i, i + 400));
      }
    }
  } else {
    const status = ack.status ? ` (${ack.status})` : "";
    irc.say(target, `Error${status}: ${ack.error ?? "unknown"}`);
  }
}

irc.on("close", () => {
  console.log("[irc] disconnected, exiting");
  process.exit(0);
});
