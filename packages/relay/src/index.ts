// MulmoBridge Relay — Cloudflare Worker entry point.
//
// Routes are auto-discovered from registered platform plugins.
// Adding a new platform: create a file in webhooks/, implement
// PlatformPlugin, call registerPlatform(), import it below.

import type { Env, RelayMessage } from "./types.js";
import { getPlatformByPath, getConfiguredPlatforms, CONNECTION_MODES } from "./platform.js";

// ── Register platform plugins (side-effect imports) ─────────
// Each import registers itself via registerPlatform().
import "./webhooks/line.js";
import "./webhooks/telegram.js";

export { RelayDurableObject } from "./durable-object.js";

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check — shows all registered + configured platforms
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        platforms: getConfiguredPlatforms(env),
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

    // Body size check (Content-Length header)
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return new Response("Payload too large", { status: 413 });
    }

    // Route to platform plugin by path
    const plugin = getPlatformByPath(url.pathname);
    if (!plugin) {
      return new Response("Not found", { status: 404 });
    }

    if (plugin.mode !== CONNECTION_MODES.webhook || !plugin.handleWebhook) {
      return new Response("Not a webhook platform", { status: 400 });
    }

    if (!plugin.isConfigured(env)) {
      return new Response(`${plugin.name} not configured`, { status: 404 });
    }

    try {
      const body = await readBodyWithLimit(request);
      const messages = await plugin.handleWebhook(request, body, env);
      await enqueueMessages(messages, env);
      return new Response("ok", { status: 200 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("verification failed") || msg.includes("not configured")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response("Internal error", { status: 500 });
    }
  },
};

// ── Helpers ──────────────────────────────────────────────────

async function readBodyWithLimit(request: Request): Promise<string> {
  const body = await request.text();
  if (body.length > MAX_BODY_SIZE) {
    throw new Error("Payload too large");
  }
  return body;
}

async function enqueueMessages(messages: RelayMessage[], env: Env): Promise<void> {
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

async function forwardToDurableObject(request: Request, env: Env, path: string): Promise<Response> {
  const durableObjectId = env.RELAY.idFromName("singleton");
  const stub = env.RELAY.get(durableObjectId);
  const url = new URL(request.url);
  url.pathname = path;
  return stub.fetch(new Request(url.toString(), request));
}
