#!/usr/bin/env node
// @mulmobridge/viber — Viber Public Account bot bridge for MulmoClaude.
//
// Viber posts events to a configured webhook and the bot replies via the
// Viber Bot REST API. Signature verification uses HMAC-SHA256 of the raw
// body keyed on the auth token (X-Viber-Content-Signature header).
//
// **Public URL required** (Viber only supports webhook delivery).
//
// Required env vars:
//   VIBER_AUTH_TOKEN — Public Account token from the Viber Admin Panel
//
// Optional:
//   VIBER_SENDER_NAME  — Display name used when sending (default "MulmoClaude")
//   VIBER_WEBHOOK_PORT — HTTP port (default 3012)
//   VIBER_ALLOWED_USERS — CSV of sender user IDs allowed (empty = all)

import "dotenv/config";
import crypto from "crypto";
import express, { type Request, type Response as ExpressResponse } from "express";
import { createBridgeClient, chunkText } from "@mulmobridge/client";

const TRANSPORT_ID = "viber";
const MAX_VIBER_TEXT = 7_000;
const FETCH_TIMEOUT_MS = 15_000;
const PORT = Number(process.env.VIBER_WEBHOOK_PORT) || 3012;
const VIBER_API = "https://chatapi.viber.com/pa";

const authToken = process.env.VIBER_AUTH_TOKEN;
if (!authToken) {
  console.error("VIBER_AUTH_TOKEN is required.\n" + "See README for setup instructions.");
  process.exit(1);
}

const senderName = process.env.VIBER_SENDER_NAME ?? "MulmoClaude";
const allowedUsers = new Set(
  (process.env.VIBER_ALLOWED_USERS ?? "")
    .split(",")
    .map((user) => user.trim())
    .filter(Boolean),
);
const allowAll = allowedUsers.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((pushEvent) => {
  sendViber(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[viber] push send failed: ${err}`));
});

// ── Viber REST: send ───────────────────────────────────────────

async function sendViber(receiverId: string, text: string): Promise<void> {
  const chunks = chunkText(text, MAX_VIBER_TEXT);
  for (const chunk of chunks) {
    let res: Response;
    try {
      res = await fetch(`${VIBER_API}/send_message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Viber-Auth-Token": authToken! },
        body: JSON.stringify({
          receiver: receiverId,
          type: "text",
          text: chunk,
          sender: { name: senderName },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      console.error(`[viber] network error: ${err}`);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[viber] send failed: ${res.status} ${detail.slice(0, 200)}`);
      continue;
    }
    // Viber returns {status: 0} on success; log non-zero as warnings
    const body: unknown = await res.json().catch(() => null);
    if (body && typeof body === "object" && "status" in body && (body as { status: number }).status !== 0) {
      console.warn(`[viber] send non-zero status: ${JSON.stringify(body)}`);
    }
  }
}

// ── Signature verification ─────────────────────────────────────

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", authToken!).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── Webhook handler ────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

function isObj(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

interface IncomingViber {
  senderId: string;
  text: string;
}

function parseMessageEvent(body: unknown): IncomingViber | null {
  if (!isObj(body)) return null;
  if (body.event !== "message") return null;
  const sender = isObj(body.sender) ? body.sender : null;
  const message = isObj(body.message) ? body.message : null;
  if (!sender || !message) return null;
  const senderId = typeof sender.id === "string" ? sender.id : "";
  const textFieldOk = message.type === "text" && typeof message.text === "string";
  const text = textFieldOk ? String(message.text).trim() : "";
  if (!senderId || !text) return null;
  return { senderId, text };
}

const app = express();
app.disable("x-powered-by");
// Parse as raw text so HMAC runs on the exact bytes Viber signed.
app.use(express.text({ type: "application/json", limit: "1mb" }));

app.get("/health", (__req, res) => {
  res.json({ status: "ok", transport: TRANSPORT_ID });
});

app.post("/viber", async (req: Request, res: ExpressResponse) => {
  const signature = typeof req.headers["x-viber-content-signature"] === "string" ? req.headers["x-viber-content-signature"] : "";
  const rawBody = typeof req.body === "string" ? req.body : "";

  if (!signature || !verifySignature(rawBody, signature)) {
    console.warn("[viber] AUTH_FAILED: signature mismatch");
    res.status(401).send("Invalid signature");
    return;
  }

  // ACK immediately so Viber doesn't retry.
  res.status(200).send("OK");

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return;
  }

  const incoming = parseMessageEvent(body);
  if (!incoming) return;

  if (!allowAll && !allowedUsers.has(incoming.senderId)) {
    console.log(`[viber] denied from=${incoming.senderId}`);
    return;
  }

  console.log(`[viber] message from=${incoming.senderId.slice(0, 8)}… len=${incoming.text.length}`);

  try {
    const ack = await mulmo.send(incoming.senderId, incoming.text);
    if (ack.ok) {
      await sendViber(incoming.senderId, ack.reply ?? "");
    } else {
      const statusSuffix = ack.status ? ` (${ack.status})` : "";
      await sendViber(incoming.senderId, `Error${statusSuffix}: ${ack.error ?? "unknown"}`);
    }
  } catch (err) {
    console.error(`[viber] message handling failed: ${err}`);
  }
});

app.listen(PORT, () => {
  console.log("MulmoClaude Viber bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/viber`);
  console.log(`Sender: ${senderName}`);
  console.log(`Allowlist: ${allowAll ? "(all)" : [...allowedUsers].join(", ")}`);
});
