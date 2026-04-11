import { WebSocketServer, WebSocket } from "ws";
import http from "http";

export interface IPubSub {
  /** Publish data to all clients subscribed to this channel. */
  publish(channel: string, data: unknown): void;
}

/** Attach WebSocket server to an existing HTTP server. Returns the pub/sub API. */
export function createPubSub(server: http.Server): IPubSub {
  const wss = new WebSocketServer({ server, path: "/ws/pubsub" });
  const subscriptions = new Map<WebSocket, Set<string>>();

  wss.on("connection", (ws) => {
    subscriptions.set(ws, new Set());

    ws.on("message", (raw) => {
      try {
        const msg: { action?: string; channel?: string } = JSON.parse(
          String(raw),
        );
        if (!msg.channel || typeof msg.channel !== "string") return;
        const channels = subscriptions.get(ws)!;
        if (msg.action === "subscribe") channels.add(msg.channel);
        if (msg.action === "unsubscribe") channels.delete(msg.channel);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      subscriptions.delete(ws);
    });
  });

  return {
    publish(channel: string, data: unknown) {
      const payload = JSON.stringify({ channel, data });
      for (const [ws, channels] of subscriptions) {
        if (channels.has(channel) && ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    },
  };
}
