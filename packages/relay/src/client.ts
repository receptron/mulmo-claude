// Relay WebSocket client for MulmoClaude.
//
// Connects to the relay server, receives messages from all
// platforms, and sends responses back. Auto-reconnects on
// disconnect with exponential backoff.
//
// The bearer token is sent as a query parameter (?token=...)
// because the browser WebSocket API does not support custom
// Authorization headers.

import type { RelayMessage, RelayResponse } from "./types.js";

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

export interface RelayClientOptions {
  url: string;
  token: string;
  onMessage: (msg: RelayMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Error) => void;
}

export interface RelayClient {
  connect: () => void;
  send: (response: RelayResponse) => void;
  disconnect: () => void;
  readonly connected: boolean;
}

export function createRelayClient(opts: RelayClientOptions): RelayClient {
  let webSocket: WebSocket | null = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;

  function buildUrl(): string {
    const url = new URL(opts.url);
    url.searchParams.set("token", opts.token);
    return url.toString();
  }

  function connect(): void {
    intentionalClose = false;
    try {
      webSocket = new WebSocket(buildUrl());

      webSocket.onopen = () => {
        backoffMs = INITIAL_BACKOFF_MS;
        opts.onConnect?.();
      };

      webSocket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        try {
          const msg: RelayMessage = JSON.parse(event.data);
          opts.onMessage(msg);
        } catch {
          // ignore malformed
        }
      };

      webSocket.onclose = () => {
        webSocket = null;
        opts.onDisconnect?.();
        if (!intentionalClose) scheduleReconnect();
      };

      webSocket.onerror = () => {
        opts.onError?.(new Error("WebSocket error"));
      };
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      connect();
    }, backoffMs);
  }

  function send(response: RelayResponse): void {
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
      opts.onError?.(new Error("not connected"));
      return;
    }
    webSocket.send(JSON.stringify(response));
  }

  function disconnect(): void {
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (webSocket) {
      webSocket.close(1000, "client disconnect");
      webSocket = null;
    }
  }

  return {
    connect,
    send,
    disconnect,
    get connected() {
      return webSocket !== null && webSocket.readyState === WebSocket.OPEN;
    },
  };
}
