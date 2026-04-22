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
import crypto from "crypto";
import express, { type Request, type Response } from "express";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const TRANSPORT_ID = "messenger";
const PORT = Number(process.env.MESSENGER_BRIDGE_PORT) || 3004;

const pageAccessToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;
const appSecret = process.env.MESSENGER_APP_SECRET;
if (!pageAccessToken || !verifyToken || !appSecret) {
  console.error("MESSENGER_PAGE_ACCESS_TOKEN, MESSENGER_VERIFY_TOKEN, and MESSENGER_APP_SECRET are required.\n" + "See README for setup instructions.");
  process.exit(1);
}

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

// ── Signature verification ──────────────────────────────────────

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", appSecret!).update(rawBody).digest("hex");
  const provided = signature.replace("sha256=", "");
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

// ── Webhook server ──────────────────────────────────────────────

const BODY_LIMIT = "1mb";
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function rateLimitCheck(clientIp: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(clientIp);
  if (!entry || now >= entry.resetAt) {
    requestCounts.set(clientIp, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_REQUESTS_PER_WINDOW;
}

const app = express();
app.disable("x-powered-by");
app.use(express.text({ type: "application/json", limit: BODY_LIMIT }));

// Webhook verification (GET)
app.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === verifyToken) {
    console.log("[messenger] webhook verified");
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Forbidden");
  }
});

async function handleWebhookBody(rawBody: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.error("[messenger] malformed JSON");
    return;
  }
  for (const msg of extractMessages(parsed)) {
    await processOneMessage(msg);
  }
}

// Webhook events (POST)
app.post("/webhook", async (req: Request, res: Response) => {
  const clientIp = req.ip ?? "unknown";
  if (!rateLimitCheck(clientIp)) {
    res.status(429).send("Too Many Requests");
    return;
  }

  const signature = typeof req.headers["x-hub-signature-256"] === "string" ? req.headers["x-hub-signature-256"] : "";
  const rawBody = typeof req.body === "string" ? req.body : "";

  if (!signature || !verifySignature(rawBody, signature)) {
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

async function processOneMessage(msg: ExtractedMessage): Promise<void> {
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

// ── Payload extraction ──────────────────────────────────────────

interface ExtractedMessage {
  senderId: string;
  text: string;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOneEvent(event: unknown): ExtractedMessage | null {
  if (!isObj(event)) return null;
  if (!isObj(event.sender) || typeof event.sender.id !== "string") return null;
  if (!isObj(event.message) || typeof event.message.text !== "string") return null;
  const text = event.message.text.trim();
  if (!text) return null;
  return { senderId: event.sender.id, text };
}

function extractMessages(body: unknown): ExtractedMessage[] {
  if (!isObj(body) || !Array.isArray(body.entry)) return [];
  const out: ExtractedMessage[] = [];
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      const msg = parseOneEvent(event);
      if (msg) out.push(msg);
    }
  }
  return out;
}

// ── Start ───────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("MulmoClaude Messenger bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/webhook`);
});
