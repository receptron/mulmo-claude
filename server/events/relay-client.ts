// MulmoBridge Relay WebSocket client.
//
// Connects to the Relay (Cloudflare Workers) and forwards incoming
// platform messages to the chat-service relay function. Handles
// reconnection with exponential backoff.
//
// NOTE: packages/relay/src/client.ts is a parallel implementation
// for browser/edge environments using the global WebSocket API.
// This module uses the `ws` npm package for Node.js. If you change
// reconnection logic or URL handling here, check the other file too.

import WebSocket from "ws";
import type { ChatService } from "@mulmobridge/chat-service";
import { ONE_SECOND_MS } from "../utils/time.js";

type RelayFn = ChatService["relay"];

// ── Types ────────────────────────────────────────────────────

interface RelayMessage {
  id: string;
  platform: string;
  senderId: string;
  chatId: string;
  text: string;
  receivedAt: string;
  replyToken?: string;
}

interface RelayResponse {
  platform: string;
  chatId: string;
  text: string;
  replyToken?: string;
}

interface Logger {
  info(prefix: string, msg: string, data?: unknown): void;
  warn(prefix: string, msg: string, data?: unknown): void;
  error(prefix: string, msg: string, data?: unknown): void;
}

export interface RelayClientDeps {
  relayUrl: string;
  relayToken: string;
  relay: RelayFn;
  logger: Logger;
}

export interface RelayClientHandle {
  disconnect(): void;
}

// ── Constants ────────────────────────────────────────────────

const LOG_PREFIX = "relay-client";
const TRANSPORT_ID = "relay";
const MIN_RECONNECT_MS = ONE_SECOND_MS;
const MAX_RECONNECT_MS = 30 * ONE_SECOND_MS;
const MAX_RESPONSE_QUEUE = 100;

// ── Factory ─────────────────────────────────────────────────

export function connectRelay(deps: RelayClientDeps): RelayClientHandle {
  const { relayUrl, relayToken, relay, logger } = deps;

  let ws: WebSocket | null = null;
  let reconnectMs = MIN_RECONNECT_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const responseQueue: RelayResponse[] = [];

  function buildUrl(): string {
    const url = new URL(relayUrl);
    url.searchParams.set("token", relayToken);
    return url.toString();
  }

  function connect(): void {
    if (stopped) return;

    try {
      ws = new WebSocket(buildUrl());
    } catch (err) {
      logger.error(LOG_PREFIX, "failed to create WebSocket", {
        error: err instanceof Error ? err.message : String(err),
      });
      scheduleReconnect();
      return;
    }

    ws.on("open", () => {
      logger.info(LOG_PREFIX, "connected", { url: relayUrl });
      reconnectMs = MIN_RECONNECT_MS;
      flushResponseQueue();
    });

    ws.on("message", (data) => {
      handleMessage(String(data));
    });

    ws.on("close", (code, reason) => {
      logger.info(LOG_PREFIX, "disconnected", {
        code,
        reason: String(reason),
      });
      ws = null;
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      logger.warn(LOG_PREFIX, "connection error", {
        error: err.message,
      });
      // close event will follow, triggering reconnect
    });
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    logger.info(LOG_PREFIX, "reconnecting", { delayMs: reconnectMs });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
  }

  async function handleMessage(raw: string): Promise<void> {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      logger.warn(LOG_PREFIX, "invalid JSON from relay", {
        length: raw.length,
      });
      return;
    }

    if (!msg.text || !msg.chatId) {
      logger.warn(LOG_PREFIX, "malformed relay message", { id: msg.id });
      return;
    }

    logger.info(LOG_PREFIX, "message received", {
      id: msg.id,
      platform: msg.platform,
      chatId: msg.chatId,
      textLength: msg.text.length,
    });

    const externalChatId = `${msg.platform}-${msg.chatId}`;

    try {
      const result = await relay({
        transportId: TRANSPORT_ID,
        externalChatId,
        text: msg.text,
      });

      const replyText = result.kind === "ok" ? result.reply : `Error: ${result.message}`;

      sendResponse({
        platform: msg.platform,
        chatId: msg.chatId,
        text: replyText,
        replyToken: msg.replyToken,
      });
    } catch (err) {
      logger.error(LOG_PREFIX, "relay processing failed", {
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function sendResponse(response: RelayResponse): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
      return;
    }
    // Queue for delivery on reconnect
    if (responseQueue.length >= MAX_RESPONSE_QUEUE) {
      logger.error(LOG_PREFIX, "response queue full, dropping oldest", {
        platform: response.platform,
        chatId: response.chatId,
      });
      responseQueue.shift();
    }
    responseQueue.push(response);
    logger.error(LOG_PREFIX, "response queued (not connected)", {
      platform: response.platform,
      chatId: response.chatId,
      queueSize: responseQueue.length,
    });
  }

  function flushResponseQueue(): void {
    if (responseQueue.length === 0) return;
    logger.info(LOG_PREFIX, "flushing response queue", {
      count: responseQueue.length,
    });
    while (responseQueue.length > 0) {
      if (!ws || ws.readyState !== WebSocket.OPEN) break;
      const response = responseQueue.shift()!;
      ws.send(JSON.stringify(response));
    }
  }

  function disconnect(): void {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close(1000, "shutdown");
      ws = null;
    }
    logger.info(LOG_PREFIX, "stopped");
  }

  // Start immediately
  connect();

  return { disconnect };
}
