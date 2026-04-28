#!/usr/bin/env node
// @mulmobridge/mattermost — Mattermost bridge for MulmoClaude.
//
// Uses the Mattermost WebSocket API (no public URL needed).
//
// Required env vars:
//   MATTERMOST_URL        — e.g. https://mattermost.example.com
//   MATTERMOST_BOT_TOKEN  — Bot account access token
//
// Optional:
//   MATTERMOST_ALLOWED_CHANNELS — CSV of channel IDs (empty = all)

import "dotenv/config";
import WebSocket from "ws";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const TRANSPORT_ID = "mattermost";

const mmUrl = process.env.MATTERMOST_URL;
const botToken = process.env.MATTERMOST_BOT_TOKEN;
if (!mmUrl || !botToken) {
  console.error("MATTERMOST_URL and MATTERMOST_BOT_TOKEN are required.\nSee README for setup instructions.");
  process.exit(1);
}

const allowedChannels = new Set(
  (process.env.MATTERMOST_ALLOWED_CHANNELS ?? "")
    .split(",")
    .map((channelId) => channelId.trim())
    .filter(Boolean),
);
const allowAll = allowedChannels.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });
let botUserId: string | null = null;

mulmo.onPush((pushEvent) => {
  postMessage(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[mattermost] push send failed: ${err}`));
});

// ── Mattermost REST API ─────────────────────────────────────────

const apiBase = `${mmUrl.replace(/\/$/, "")}/api/v4`;

async function apiGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function postMessage(channelId: string, text: string): Promise<void> {
  const MAX = 4000;
  const chunks = chunkText(text, MAX);
  for (const chunk of chunks) {
    try {
      const res = await fetch(`${apiBase}/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify({ channel_id: channelId, message: chunk }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[mattermost] postMessage failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[mattermost] postMessage error: ${err}`);
    }
  }
}

// ── WebSocket event stream ──────────────────────────────────────

function connectWebSocket(): void {
  const wsUrl = mmUrl!.replace(/^http/, "ws").replace(/\/$/, "");
  const webSocket = new WebSocket(`${wsUrl}/api/v4/websocket`, {
    headers: { Authorization: `Bearer ${botToken}` },
  });

  webSocket.on("open", () => {
    console.log("[mattermost] WebSocket connected");
    // Authenticate
    webSocket.send(
      JSON.stringify({
        seq: 1,
        action: "authentication_challenge",
        data: { token: botToken },
      }),
    );
  });

  webSocket.on("message", async (data) => {
    try {
      const event: {
        event?: string;
        data?: { post?: string };
      } = JSON.parse(data.toString());
      if (event.event !== "posted" || !event.data?.post) return;

      const post: {
        user_id: string;
        channel_id: string;
        message: string;
      } = JSON.parse(event.data.post);

      // Ignore own messages
      if (post.user_id === botUserId) return;
      if (!post.message.trim()) return;
      if (!allowAll && !allowedChannels.has(post.channel_id)) return;

      console.log(`[mattermost] message channel=${post.channel_id} user=${post.user_id} len=${post.message.length}`);

      const ack = await mulmo.send(post.channel_id, post.message);
      if (ack.ok) {
        await postMessage(post.channel_id, ack.reply ?? "");
      } else {
        const status = ack.status ? ` (${ack.status})` : "";
        await postMessage(post.channel_id, `Error${status}: ${ack.error ?? "unknown"}`);
      }
    } catch (err) {
      console.error(`[mattermost] message handling failed: ${err}`);
    }
  });

  webSocket.on("close", () => {
    console.log("[mattermost] WebSocket closed, reconnecting in 5s...");
    setTimeout(connectWebSocket, 5000);
  });

  webSocket.on("error", (err) => {
    console.error(`[mattermost] WebSocket error: ${err.message}`);
  });
}

async function main(): Promise<void> {
  const currentUser = await apiGet("/users/me");
  const currentUserId = typeof currentUser.id === "string" ? currentUser.id : "";
  const username = typeof currentUser.username === "string" ? currentUser.username : "unknown";
  botUserId = currentUserId;

  console.log("MulmoClaude Mattermost bridge");
  console.log(`Server: ${mmUrl}`);
  console.log(`Bot: ${username}`);
  console.log(`Channels: ${allowAll ? "(all)" : [...allowedChannels].join(", ")}`);

  connectWebSocket();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
