/* eslint-disable no-undef -- Cloudflare Workers globals (DurableObject, WebSocketPair, etc.) */
// RelayDurableObject — WebSocket server + message queue.
//
// Holds a single WS connection to MulmoClaude. When connected,
// incoming webhook messages are forwarded immediately. When
// disconnected, messages are queued in Durable Object storage
// and delivered on reconnect.

import type { RelayMessage, RelayResponse, Env } from "./types.js";
import { sendLineReply, sendLinePush } from "./webhooks/line.js";
import { sendTelegramMessage } from "./webhooks/telegram.js";
import { PLATFORMS } from "./types.js";

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

    // Auth: token from query param (WS API can't set headers)
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token || token !== this.env.RELAY_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Close existing connection (1 connection limit)
    if (this.ws) {
      try {
        this.ws.close(1000, "replaced by new connection");
      } catch {
        // already closed
      }
      this.ws = null;
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server);
    this.ws = server;

    // Deliver queued messages
    this.flushQueue().catch(() => {});

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    _ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") return;

    let response: RelayResponse;
    try {
      response = JSON.parse(message);
    } catch {
      return; // malformed JSON — skip
    }

    try {
      await this.handleResponse(response);
    } catch (err) {
      // Platform delivery failed — send error back to MulmoClaude
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
      // Connected — forward immediately
      try {
        this.ws.send(JSON.stringify(msg));
        return new Response("forwarded", { status: 200 });
      } catch {
        this.ws = null;
        // Fall through to queue
      }
    }

    // Not connected — queue
    await this.enqueue(msg);
    return new Response("queued", { status: 202 });
  }

  private async enqueue(msg: RelayMessage): Promise<void> {
    const key = `${QUEUE_KEY_PREFIX}${msg.receivedAt}:${msg.id}`;
    await this.state.storage.put(key, JSON.stringify(msg));

    // Enforce max queue size
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
        break; // WS failed, stop flushing
      }
    }
  }

  private async listQueueKeys(): Promise<string[]> {
    const map = await this.state.storage.list({
      prefix: QUEUE_KEY_PREFIX,
    });
    return [...map.keys()].sort();
  }

  // ── Response handling (send replies back to platforms) ──────

  private async handleResponse(response: RelayResponse): Promise<void> {
    if (response.platform === PLATFORMS.line) {
      const accessToken = this.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!accessToken) return;

      if (response.replyToken) {
        await sendLineReply(response.replyToken, response.text, accessToken);
      } else {
        await sendLinePush(response.chatId, response.text, accessToken);
      }
    } else if (response.platform === PLATFORMS.telegram) {
      const botToken = this.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return;
      await sendTelegramMessage(response.chatId, response.text, botToken);
    }
  }
}
