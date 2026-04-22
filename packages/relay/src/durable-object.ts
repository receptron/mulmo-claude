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
import "./webhooks/whatsapp.js";
import "./webhooks/messenger.js";
import "./webhooks/google-chat.js";
import "./webhooks/teams.js";

const MAX_QUEUE_SIZE = 1000;
const QUEUE_KEY_PREFIX = "q:";

export class RelayDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /** Return the live OPEN WebSocket, surviving Durable Object
   *  hibernation. Filters out CLOSING/CLOSED sockets and closes
   *  any extras from reconnect races. */
  private getSocket(): WebSocket | null {
    const sockets = this.state.getWebSockets().filter((socket) => socket.readyState === WebSocket.READY_STATE_OPEN);
    if (sockets.length === 0) return null;
    // Enforce single connection: close extras from reconnect races
    for (let i = 1; i < sockets.length; i++) {
      try {
        sockets[i].close(1000, "duplicate connection");
      } catch {
        /* already closing */
      }
    }
    return sockets[0];
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

    for (const existing of this.state.getWebSockets()) {
      try {
        existing.close(1000, "replaced by new connection");
      } catch {
        /* already closed */
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server);

    this.flushQueue().catch(() => {});

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(__ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
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
      const webSocket = this.getSocket();
      webSocket?.send(
        JSON.stringify({
          type: "error",
          platform: response.platform,
          chatId: response.chatId,
          error: errorMsg,
        }),
      );
    }
  }

  async webSocketClose(__ws: WebSocket, __code: number, __reason: string, __wasClean: boolean): Promise<void> {
    // No-op: getSocket() derives state from the runtime, not an
    // instance field, so there is nothing to clear.
  }

  async webSocketError(__ws: WebSocket, __error: unknown): Promise<void> {
    // No-op: same as webSocketClose.
  }

  // ── Message enqueue ────────────────────────────────────────

  private async handleEnqueue(request: Request): Promise<Response> {
    const msg: RelayMessage = await request.json();

    const webSocket = this.getSocket();
    if (webSocket) {
      try {
        webSocket.send(JSON.stringify(msg));
        return new Response("forwarded", { status: 200 });
      } catch {
        // Socket broken — fall through to queue.
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
    const webSocket = this.getSocket();
    if (!webSocket) return;

    const keys = await this.listQueueKeys();
    for (const key of keys) {
      const raw = await this.state.storage.get<string>(key);
      if (!raw) break;

      try {
        webSocket.send(raw);
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
    await plugin.sendResponse(response.chatId, response.text, this.env, response.replyToken);
  }
}
