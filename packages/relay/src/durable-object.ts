/* eslint-disable no-undef -- Cloudflare Workers globals (DurableObject, WebSocketPair, etc.) */
// RelayDurableObject — WebSocket server + message queue.
//
// Holds a single WS connection to MulmoClaude. When connected,
// incoming webhook messages are forwarded immediately. When
// disconnected, messages are queued in Durable Object storage
// and delivered on reconnect.

import type { RelayMessage, RelayResponse, Env } from "./types.js";
import { getPlatformByName } from "./platform.js";

// Import plugins so they register themselves
import "./webhooks/line.js";
import "./webhooks/telegram.js";

const MAX_QUEUE_SIZE = 1000;
const QUEUE_KEY_PREFIX = "q:";

export class RelayDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private ws: WebSocket | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }
    if (url.pathname === "/enqueue") {
      return this.handleEnqueue(request);
    }

    return new Response("Not found", { status: 404 });
  }

  // ── WebSocket (MulmoClaude connection) ─────────────────────

  private handleWebSocket(request: Request): Response {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token || token !== this.env.RELAY_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (this.ws) {
      try {
        this.ws.close(1000, "replaced by new connection");
      } catch {
        /* already closed */
      }
      this.ws = null;
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server);
    this.ws = server;

    this.flushQueue().catch(() => {});

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    __ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") return;

    let response: RelayResponse;
    try {
      response = JSON.parse(message);
    } catch {
      return;
    }

    try {
      await this.handleResponse(response);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.ws?.send(
        JSON.stringify({
          type: "error",
          platform: response.platform,
          chatId: response.chatId,
          error: errorMsg,
        }),
      );
    }
  }

  async webSocketClose(
    __ws: WebSocket,
    __code: number,
    __reason: string,
    __wasClean: boolean,
  ): Promise<void> {
    this.ws = null;
  }

  async webSocketError(__ws: WebSocket, __error: unknown): Promise<void> {
    this.ws = null;
  }

  // ── Message enqueue ────────────────────────────────────────

  private async handleEnqueue(request: Request): Promise<Response> {
    const msg: RelayMessage = await request.json();

    if (this.ws) {
      try {
        this.ws.send(JSON.stringify(msg));
        return new Response("forwarded", { status: 200 });
      } catch {
        this.ws = null;
      }
    }

    await this.enqueue(msg);
    return new Response("queued", { status: 202 });
  }

  private async enqueue(msg: RelayMessage): Promise<void> {
    const key = `${QUEUE_KEY_PREFIX}${msg.receivedAt}:${msg.id}`;
    await this.state.storage.put(key, JSON.stringify(msg));

    const keys = await this.listQueueKeys();
    if (keys.length > MAX_QUEUE_SIZE) {
      const toDelete = keys.slice(0, keys.length - MAX_QUEUE_SIZE);
      await this.state.storage.delete(toDelete);
    }
  }

  private async flushQueue(): Promise<void> {
    if (!this.ws) return;

    const keys = await this.listQueueKeys();
    for (const key of keys) {
      const raw = await this.state.storage.get<string>(key);
      if (!raw || !this.ws) break;

      try {
        this.ws.send(raw);
        await this.state.storage.delete(key);
      } catch {
        break;
      }
    }
  }

  private async listQueueKeys(): Promise<string[]> {
    const map = await this.state.storage.list({ prefix: QUEUE_KEY_PREFIX });
    return [...map.keys()].sort();
  }

  // ── Response routing (plugin-based) ───────────────────────

  private async handleResponse(response: RelayResponse): Promise<void> {
    const plugin = getPlatformByName(response.platform);
    if (!plugin) {
      throw new Error(`unknown platform: ${response.platform}`);
    }
    await plugin.sendResponse(
      response.chatId,
      response.text,
      this.env,
      response.replyToken,
    );
  }
}
