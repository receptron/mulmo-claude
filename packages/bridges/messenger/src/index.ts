#!/usr/bin/env node
// @mulmobridge/messenger — Facebook Messenger bridge for MulmoClaude.
//
// Uses the Meta Send/Receive API (webhook mode, same infra as WhatsApp).
//
// Required env vars:
//   MESSENGER_PAGE_ACCESS_TOKEN — Page access token
//   MESSENGER_VERIFY_TOKEN      — Arbitrary string for webhook verification
//   MESSENGER_APP_SECRET        — App secret for x-hub-signature-256 HMAC
//
// Optional:
//   MESSENGER_BRIDGE_PORT — Webhook port (default: 3004)

import "dotenv/config";
import type { Request, Response } from "express";
import { createWebhookApp, createWebhookRateLimit, registerMetaWebhookVerification, verifyMetaHmacSignature } from "@mulmobridge/webhook-runtime";
import { createBridgeClient, chunkText } from "@mulmobridge/client";
import { extractMessengerMessages, type MessengerTextMessage } from "@mulmoclaude/common/meta-webhook";

const TRANSPORT_ID = "messenger";
const PORT = Number(process.env.MESSENGER_BRIDGE_PORT) || 3004;

function readRequiredEnv(): { pageAccessToken: string; verifyToken: string; appSecret: string } {
  const pageAccessToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;
  const appSecret = process.env.MESSENGER_APP_SECRET;
  if (!pageAccessToken || !verifyToken || !appSecret) {
    console.error("MESSENGER_PAGE_ACCESS_TOKEN, MESSENGER_VERIFY_TOKEN, and MESSENGER_APP_SECRET are required.\nSee README for setup instructions.");
    process.exit(1);
  }
  return { pageAccessToken, verifyToken, appSecret };
}
const { pageAccessToken, verifyToken, appSecret } = readRequiredEnv();

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((pushEvent) => {
  sendTextMessage(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[messenger] push send failed: ${err}`));
});

// ── Messenger Send API ──────────────────────────────────────────

async function sendTextMessage(recipientId: string, text: string): Promise<void> {
  const MAX = 2000; // Messenger's message limit
  const chunks = chunkText(text, MAX);

  for (const chunk of chunks) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${pageAccessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: chunk },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[messenger] send failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[messenger] send error: ${err}`);
    }
  }
}

// ── Webhook server ──────────────────────────────────────────────

const webhookRateLimit = createWebhookRateLimit();
// bodyLimit 1mb: Meta can send larger payloads than Express's 100kb default.
const app = createWebhookApp({ bodyLimit: "1mb" });

// Webhook verification (GET). Rate-limited so a flood of bogus `hub.challenge`
// probes can't hammer the bridge before the `hub.verify_token` check rejects
// them; the shared handler applies the `js/reflected-xss` challenge whitelist.
registerMetaWebhookVerification(app, { rateLimit: webhookRateLimit, verifyToken, label: "messenger" });

async function handleWebhookBody(rawBody: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.error("[messenger] malformed JSON");
    return;
  }
  for (const msg of extractMessengerMessages(parsed)) {
    await processOneMessage(msg);
  }
}

// Webhook events (POST). Rate-limited per-IP via `webhookRateLimit`
// above; the middleware writes the 429 response itself when the cap
// is hit so the handler body only sees admitted requests.
app.post("/webhook", webhookRateLimit, async (req: Request, res: Response) => {
  const signature = typeof req.headers["x-hub-signature-256"] === "string" ? req.headers["x-hub-signature-256"] : "";
  const rawBody = typeof req.body === "string" ? req.body : "";

  if (!signature || !verifyMetaHmacSignature(rawBody, signature, appSecret)) {
    console.warn("[messenger] AUTH_FAILED: signature verification failed");
    res.status(401).send("Invalid signature");
    return;
  }

  res.status(200).send("EVENT_RECEIVED");
  await handleWebhookBody(rawBody);
});

function redactId(resourceId: string): string {
  return resourceId.length > 6 ? `${resourceId.slice(0, 3)}***${resourceId.slice(-3)}` : "***";
}

async function processOneMessage(msg: MessengerTextMessage): Promise<void> {
  console.log(`[messenger] message from=${redactId(msg.senderId)} len=${msg.text.length}`);
  try {
    const ack = await mulmo.send(msg.senderId, msg.text);
    if (ack.ok) {
      await sendTextMessage(msg.senderId, ack.reply ?? "");
    } else {
      const status = ack.status ? ` (${ack.status})` : "";
      await sendTextMessage(msg.senderId, `Error${status}: ${ack.error ?? "unknown"}`);
    }
  } catch (err) {
    console.error(`[messenger] message handling failed: ${err}`);
  }
}

// ── Start ───────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("MulmoClaude Messenger bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/webhook`);
});
