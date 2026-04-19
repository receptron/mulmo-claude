#!/usr/bin/env node
// @mulmobridge/whatsapp — WhatsApp bridge for MulmoClaude.
//
// Uses Meta's WhatsApp Cloud API (webhook mode).
// Requires a Meta Business account + WhatsApp Business API setup.
//
// Required env vars:
//   WHATSAPP_ACCESS_TOKEN    — permanent access token
//   WHATSAPP_PHONE_NUMBER_ID — phone number ID from Meta dashboard
//   WHATSAPP_VERIFY_TOKEN    — any string for webhook verification
//
// Optional:
//   WHATSAPP_BRIDGE_PORT      — webhook port (default: 3003)
//   WHATSAPP_ALLOWED_NUMBERS  — CSV of phone numbers (empty = all)

import "dotenv/config";
import express, { type Request, type Response } from "express";
import { createBridgeClient } from "@mulmobridge/client";

const TRANSPORT_ID = "whatsapp";
const PORT = Number(process.env.WHATSAPP_BRIDGE_PORT) || 3003;

const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
if (!accessToken || !phoneNumberId || !verifyToken) {
  console.error(
    "WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN are required.\n" +
      "See README for setup instructions.",
  );
  process.exit(1);
}

const allowedNumbers = new Set(
  (process.env.WHATSAPP_ALLOWED_NUMBERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const allowAll = allowedNumbers.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((ev) => {
  sendWhatsAppMessage(ev.chatId, ev.message).catch((err) =>
    console.error(`[whatsapp] push send failed: ${err}`),
  );
});

// ── WhatsApp Cloud API ──────────────────────────────────────────

const API_BASE = `https://graph.facebook.com/v21.0/${phoneNumberId}`;

async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  // WhatsApp max message length is ~65536 but we chunk for readability
  const MAX = 4096;
  const chunks =
    text.length === 0
      ? ["(empty reply)"]
      : Array.from({ length: Math.ceil(text.length / MAX) }, (_, i) =>
          text.slice(i * MAX, (i + 1) * MAX),
        );

  for (const chunk of chunks) {
    const res = await fetch(`${API_BASE}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: chunk },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[whatsapp] sendMessage failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }
  }
}

// ── Webhook server ──────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// Webhook verification (GET)
app.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[whatsapp] webhook verified");
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Forbidden");
  }
});

interface WhatsAppTextMessage {
  from: string;
  type: string;
  text?: { body: string };
}

function extractMessages(body: Record<string, unknown>): WhatsAppTextMessage[] {
  const entries = (body.entry ?? []) as Array<{
    changes?: Array<{ value?: { messages?: WhatsAppTextMessage[] } }>;
  }>;
  const out: WhatsAppTextMessage[] = [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (msg.type === "text" && msg.text?.body) out.push(msg);
      }
    }
  }
  return out;
}

// Webhook events (POST)
app.post("/webhook", async (req: Request, res: Response) => {
  res.status(200).send("OK");

  for (const msg of extractMessages(req.body as Record<string, unknown>)) {
    const from = msg.from;
    const text = msg.text!.body;

    if (!allowAll && !allowedNumbers.has(from)) {
      console.log(`[whatsapp] denied from=${from}`);
      continue;
    }

    console.log(`[whatsapp] message from=${from} len=${text.length}`);

    const ack = await mulmo.send(from, text);
    if (ack.ok) {
      await sendWhatsAppMessage(from, ack.reply ?? "");
    } else {
      const status = ack.status ? ` (${ack.status})` : "";
      await sendWhatsAppMessage(
        from,
        `Error${status}: ${ack.error ?? "unknown"}`,
      );
    }
  }
});

app.listen(PORT, () => {
  console.log("MulmoClaude WhatsApp bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/webhook`);
  console.log("Set your Meta webhook URL to: <public-url>/webhook");
});
