#!/usr/bin/env node
// @mulmobridge/line — LINE bridge for MulmoClaude.
//
// Runs a small HTTP server to receive LINE webhook events.
// Requires a public URL (use ngrok for development).
//
// Required env vars:
//   LINE_CHANNEL_SECRET      — Channel secret from LINE Developers Console
//   LINE_CHANNEL_ACCESS_TOKEN — Channel access token (long-lived)
//
// Optional:
//   LINE_BRIDGE_PORT          — Webhook listener port (default: 3002)
//   MULMOCLAUDE_API_URL       — default http://localhost:3001
//   MULMOCLAUDE_AUTH_TOKEN    — bearer token

import "dotenv/config";
import crypto from "crypto";
import express, { type Request, type Response } from "express";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const TRANSPORT_ID = "line";
const PORT = Number(process.env.LINE_BRIDGE_PORT) || 3002;

const channelSecret = process.env.LINE_CHANNEL_SECRET;
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!channelSecret || !channelAccessToken) {
  console.error("LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN are required.\n" + "See README for setup instructions.");
  process.exit(1);
}

const client = createBridgeClient({ transportId: TRANSPORT_ID });

client.onPush((ev) => {
  pushMessage(ev.chatId, ev.message).catch((err) => console.error(`[line] push send failed: ${err}`));
});

// ── LINE API helpers ────────────────────────────────────────────

async function pushMessage(userId: string, text: string): Promise<void> {
  const messages = chunkText(text, 5000).map((t) => ({
    type: "text",
    text: t,
  }));
  // LINE allows max 5 messages per push
  for (let i = 0; i < messages.length; i += 5) {
    try {
      const res = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: messages.slice(i, i + 5),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[line] pushMessage failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[line] pushMessage network error: ${err}`);
    }
  }
}

// ── Signature verification ──────────────────────────────────────

function verifySignature(body: string, signature: string): boolean {
  const expected = crypto.createHmac("SHA256", channelSecret!).update(body).digest("base64");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ── Webhook server ──────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");
app.use(express.text({ type: "application/json" }));

app.post("/webhook", async (req: Request, res: Response) => {
  const signature = req.headers["x-line-signature"] as string;
  const bodyStr = req.body as string;

  if (!signature || !verifySignature(bodyStr, signature)) {
    res.status(401).send("Invalid signature");
    return;
  }

  res.status(200).send("OK");

  let body: {
    events: Array<{
      type: string;
      replyToken?: string;
      source?: { userId?: string; type?: string };
      message?: { type: string; text?: string };
    }>;
  };
  try {
    body = JSON.parse(bodyStr);
  } catch {
    console.error("[line] malformed JSON in webhook body");
    return;
  }

  for (const event of body.events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const userId = event.source?.userId;
    const text = event.message?.text ?? "";
    if (!userId || !text.trim()) continue;

    console.log(`[line] message user=${userId} len=${text.length}`);

    try {
      const ack = await client.send(userId, text);
      if (ack.ok) {
        await pushMessage(userId, ack.reply ?? "");
      } else {
        const status = ack.status ? ` (${ack.status})` : "";
        await pushMessage(userId, `Error${status}: ${ack.error ?? "unknown"}`);
      }
    } catch (err) {
      console.error(`[line] message handling failed: ${err}`);
    }
  }
});

app.listen(PORT, () => {
  console.log("MulmoClaude LINE bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/webhook`);
  console.log("Set your LINE webhook URL to: <public-url>/webhook");
});
