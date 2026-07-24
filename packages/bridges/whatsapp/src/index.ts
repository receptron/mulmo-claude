#!/usr/bin/env node
// @mulmobridge/whatsapp — WhatsApp bridge for MulmoClaude.
//
// Uses Meta's WhatsApp Cloud API (webhook mode).
//
// Required env vars:
//   WHATSAPP_ACCESS_TOKEN    — permanent access token
//   WHATSAPP_PHONE_NUMBER_ID — phone number ID from Meta dashboard
//   WHATSAPP_VERIFY_TOKEN    — any string for webhook verification
//   WHATSAPP_APP_SECRET      — App secret for x-hub-signature-256 HMAC
//
// Optional:
//   WHATSAPP_BRIDGE_PORT      — webhook port (default: 3003)
//   WHATSAPP_ALLOWED_NUMBERS  — CSV of phone numbers (empty = all)

import "dotenv/config";
import type { Request, Response } from "express";
import { createBridgeClient } from "@mulmobridge/client";
import { createWebhookApp, createWebhookRateLimit, registerMetaWebhookVerification, verifyMetaHmacSignature } from "@mulmobridge/webhook-runtime";
import { parseCsvSet } from "@mulmoclaude/common";
import { extractWhatsAppMessages } from "@mulmoclaude/common/meta-webhook";

const TRANSPORT_ID = "whatsapp";
const PORT = Number(process.env.WHATSAPP_BRIDGE_PORT) || 3003;
const FETCH_TIMEOUT_MS = 30_000;

function readRequiredEnv(): { accessToken: string; phoneNumberId: string; verifyToken: string; appSecret: string } {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!accessToken || !phoneNumberId || !verifyToken || !appSecret) {
    console.error(
      "WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, and WHATSAPP_APP_SECRET are required.\nSee README for setup instructions.",
    );
    process.exit(1);
  }
  return { accessToken, phoneNumberId, verifyToken, appSecret };
}
const { accessToken, phoneNumberId, verifyToken, appSecret } = readRequiredEnv();

const allowedNumbers = parseCsvSet(process.env.WHATSAPP_ALLOWED_NUMBERS);
const allowAll = allowedNumbers.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((pushEvent) => {
  sendWhatsAppMessage(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[whatsapp] push send failed: ${err}`));
});

// ── WhatsApp Cloud API ──────────────────────────────────────────

const API_BASE = `https://graph.facebook.com/v21.0/${phoneNumberId}`;

async function sendWhatsAppMessage(recipientId: string, text: string): Promise<void> {
  const MAX = 4096;
  const chunks =
    text.length === 0
      ? ["(empty reply)"]
      : Array.from({ length: Math.ceil(text.length / MAX) }, (_, chunkIndex) => text.slice(chunkIndex * MAX, (chunkIndex + 1) * MAX));

  for (const chunk of chunks) {
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipientId,
          type: "text",
          text: { body: chunk },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[whatsapp] sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[whatsapp] sendMessage error: ${err}`);
    }
  }
}

// ── Webhook server ──────────────────────────────────────────────

const app = createWebhookApp();
// The verification GET shares the limiter since a flood of bogus
// `hub.challenge` probes would otherwise hammer us just as effectively.
const webhookRateLimit = createWebhookRateLimit();

// Webhook verification (GET). The shared handler echoes Meta's one-time
// `hub.challenge` only after `hub.verify_token` matches, behind the
// `narrowChallenge` `js/reflected-xss` whitelist + a `text/plain` response.
registerMetaWebhookVerification(app, { rateLimit: webhookRateLimit, verifyToken, label: "whatsapp" });

// Webhook events (POST) — signature-verified + rate-limited
app.post("/webhook", webhookRateLimit, async (req: Request, res: Response) => {
  const signature = req.headers["x-hub-signature-256"] as string;
  const rawBody = req.body as string;

  if (!signature || !verifyMetaHmacSignature(rawBody, signature, appSecret)) {
    console.warn("[whatsapp] webhook signature verification failed");
    res.status(401).send("Invalid signature");
    return;
  }

  res.status(200).send("OK");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.error("[whatsapp] malformed JSON in webhook body");
    return;
  }

  for (const msg of extractWhatsAppMessages(parsed)) {
    if (!allowAll && !allowedNumbers.has(msg.from)) {
      console.log(`[whatsapp] denied from=${msg.from}`);
      continue;
    }

    console.log(`[whatsapp] message from=${msg.from} len=${msg.text.body.length}`);

    try {
      const ack = await mulmo.send(msg.from, msg.text.body);
      if (ack.ok) {
        await sendWhatsAppMessage(msg.from, ack.reply ?? "");
      } else {
        const status = ack.status ? ` (${ack.status})` : "";
        await sendWhatsAppMessage(msg.from, `Error${status}: ${ack.error ?? "unknown"}`);
      }
    } catch (err) {
      console.error(`[whatsapp] message handling failed: ${err}`);
    }
  }
});

app.listen(PORT, () => {
  console.log("MulmoClaude WhatsApp bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/webhook`);
});
