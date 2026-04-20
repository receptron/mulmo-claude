// MulmoBridge Relay — Cloudflare Worker entry point.
//
// Routes:
//   POST /webhook/line       — LINE webhook (signature verified)
//   POST /webhook/telegram   — Telegram webhook (secret verified)
//   GET  /ws                 — MulmoClaude WebSocket connection
//   GET  /health             — health check

import type { Env, RelayMessage } from "./types.js";
import { handleLineWebhook } from "./webhooks/line.js";
import { handleTelegramWebhook } from "./webhooks/telegram.js";
export { RelayDurableObject } from "./durable-object.js";

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        platforms: {
          line: !!env.LINE_CHANNEL_SECRET,
          telegram: !!env.TELEGRAM_BOT_TOKEN,
        },
      });
    }

    // WebSocket — proxy to Durable Object
    if (url.pathname === "/ws") {
      return forwardToDurableObject(request, env, "/ws");
    }

    // Webhooks — only POST
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Body size check (header + actual body)
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return new Response("Payload too large", { status: 413 });
    }

    try {
      if (url.pathname === "/webhook/line") {
        return await handleLine(request, env);
      }
      if (url.pathname === "/webhook/telegram") {
        return await handleTelegram(request, env);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("verification failed")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response("Internal error", { status: 500 });
    }

    return new Response("Not found", { status: 404 });
  },
};

// ── Body reader with size limit ──────────────────────────────

async function readBodyWithLimit(request: Request): Promise<string> {
  const body = await request.text();
  if (body.length > MAX_BODY_SIZE) {
    throw new Error("Payload too large");
  }
  return body;
}

// ── Webhook handlers ─────────────────────────────────────────

async function handleLine(request: Request, env: Env): Promise<Response> {
  if (!env.LINE_CHANNEL_SECRET) {
    return new Response("LINE not configured", { status: 404 });
  }

  const messages = await handleLineWebhook(request, env.LINE_CHANNEL_SECRET);
  await enqueueMessages(messages, env);
  return new Response("ok", { status: 200 });
}

async function handleTelegram(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return new Response("Telegram not configured", { status: 404 });
  }

  const body = await readBodyWithLimit(request);
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  const messages = handleTelegramWebhook(
    body,
    env.TELEGRAM_WEBHOOK_SECRET,
    headerSecret,
  );

  await enqueueMessages(messages, env);
  return new Response("ok", { status: 200 });
}

// ── Durable Object helpers ───────────────────────────────────

async function enqueueMessages(
  messages: RelayMessage[],
  env: Env,
): Promise<void> {
  for (const msg of messages) {
    const response = await forwardToDurableObject(
      new Request("https://internal/enqueue", {
        method: "POST",
        body: JSON.stringify(msg),
      }),
      env,
      "/enqueue",
    );
    if (!response.ok) {
      throw new Error(`enqueue failed: ${response.status}`);
    }
  }
}

async function forwardToDurableObject(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const id = env.RELAY.idFromName("singleton");
  const stub = env.RELAY.get(id);
  const url = new URL(request.url);
  url.pathname = path;
  return stub.fetch(new Request(url.toString(), request));
}
