import http from "http";
import { Server as IOServer } from "socket.io";

export interface IPubSub {
  /** Publish data to all clients subscribed to this channel. */
  publish(channel: string, data: unknown): void;
}

// Channel names are treated as socket.io rooms — one room per
// channel. Subscribe/unsubscribe is plain `socket.join` /
// `socket.leave`. Publish broadcasts to the room. Reconnect /
// heartbeat / multi-transport fallback are handled by socket.io
// itself, which is why we switched off raw ws.

export function createPubSub(server: http.Server): IPubSub {
  const io = new IOServer(server, {
    path: "/ws/pubsub",
    // Server binds to 127.0.0.1 only, so CORS is moot — but
    // socket.io defaults to rejecting cross-origin upgrade
    // requests. Allow same-origin explicitly to cover the
    // dev-proxy case (vite serves on a different port than the
    // API server during `yarn dev`).
    cors: { origin: true, credentials: true },
    // Skip the long-poll transport negotiation: loopback-only
    // deployment can always upgrade to WebSocket, and starting
    // there avoids the 200ms long-poll round trip on first
    // connection.
    transports: ["websocket"],
  });

  io.on("connection", (socket) => {
    socket.on("subscribe", (channel: unknown) => {
      if (typeof channel === "string") socket.join(channel);
    });
    socket.on("unsubscribe", (channel: unknown) => {
      if (typeof channel === "string") socket.leave(channel);
    });
  });

  return {
    publish(channel: string, data: unknown): void {
      io.to(channel).emit("data", { channel, data });
    },
  };
}
