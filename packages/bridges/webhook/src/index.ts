#!/usr/bin/env node
// @mulmobridge/webhook — Generic webhook bridge for MulmoClaude.
//
// Any HTTP-speaking tool can POST JSON to this bridge and get the AI
// reply back in the response body. Useful as developer-facing glue
// when you want to trigger a MulmoClaude turn from a script, a shell
// pipeline, a CI job, Zapier, n8n, Home Assistant automations, etc.
//
// The bridge is synchronous: the request stays open until MulmoClaude
// replies (or the bridge client's 6-minute timeout fires). For async
// delivery, use one of the platform-specific bridges instead.
//
// Required env vars:
//   (none — runs with defaults out of the box)
//
// Optional:
//   WEBHOOK_PORT     — HTTP port (default 3009)
//   WEBHOOK_SECRET   — If set, requests must include a matching
//                      `x-webhook-secret` header (constant-time compared).
//   WEBHOOK_PATH     — Endpoint path (default "/webhook")

import "dotenv/config";
import crypto from "crypto";
import express, { type Request, type Response } from "express";
import { createBridgeClient } from "@mulmobridge/client";

const TRANSPORT_ID = "webhook";
const PORT = Number(process.env.WEBHOOK_PORT) || 3009;
const ENDPOINT = process.env.WEBHOOK_PATH ?? "/webhook";
const secret = process.env.WEBHOOK_SECRET ?? "";

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((pushEvent) => {
  // Generic webhook is request/response — there is no channel to push to.
  // Server-initiated pushes land here and are logged; bind a platform-
  // specific bridge if you need push delivery.
  console.log(`[webhook] push (not delivered): chatId=${pushEvent.chatId} len=${pushEvent.message.length}`);
});

// ── Secret check ────────────────────────────────────────────────

function secretOk(provided: string | undefined): boolean {
  if (!secret) return true;
  if (!provided) return false;
  if (provided.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

// ── Payload extraction ─────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

function isObj(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

interface Extracted {
  chatId: string;
  text: string;
}

function extractPayload(body: unknown): Extracted | null {
  if (!isObj(body)) return null;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const chatId = typeof body.chatId === "string" && body.chatId.length > 0 ? body.chatId : "default";
  if (!text) return null;
  return { chatId, text };
}

// ── HTTP server ────────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (__req, res) => {
  res.json({ status: "ok", transport: TRANSPORT_ID });
});

app.post(ENDPOINT, async (req: Request, res: Response) => {
  const provided = typeof req.headers["x-webhook-secret"] === "string" ? req.headers["x-webhook-secret"] : undefined;
  if (!secretOk(provided)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const payload = extractPayload(req.body);
  if (!payload) {
    res.status(400).json({ ok: false, error: "body must be JSON with at least { text: string } (chatId is optional)" });
    return;
  }

  console.log(`[webhook] message chatId=${payload.chatId} len=${payload.text.length}`);

  try {
    const ack = await mulmo.send(payload.chatId, payload.text);
    if (ack.ok) {
      res.json({ ok: true, reply: ack.reply ?? "" });
    } else {
      res.status(502).json({ ok: false, error: ack.error ?? "upstream error", status: ack.status });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] handler error: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.listen(PORT, () => {
  console.log("MulmoClaude Webhook bridge");
  console.log(`Listening on http://localhost:${PORT}${ENDPOINT}`);
  console.log(`Secret: ${secret ? "(set — x-webhook-secret required)" : "(none — open endpoint)"}`);
});
