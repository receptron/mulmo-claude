# Pub/Sub Channel — Design Document

## 1) Context and Problem

The server currently has no way to push messages to the client outside of request-scoped SSE streams (`POST /api/agent`, `POST /api/mulmo-script/generate-movie`). These only work while a specific request is in flight.

Background services like the Task Manager need a way to notify the client of events (task completion, status changes, etc.) at any time. Rather than adding ad-hoc push endpoints per feature, we need a single general-purpose pub/sub channel.

### Goal

A single WebSocket connection between client and server that multiplexes messages across named channels. The server can publish to any channel; the client subscribes to channels it cares about.

---

## 2) Design Goals and Non-Goals

### Goals
1. **One WebSocket** — a single persistent connection handles all pub/sub traffic.
2. **Channel-based routing** — messages are published to a named channel; only subscribers receive them.
3. **Simple API** — `publish(channel, data)` on the server, `subscribe(channel, callback)` on the client.
4. **Decoupled** — publishers and subscribers don't know about each other. Registration order doesn't matter — a subscriber can listen on a channel before any publisher exists, and vice versa.
5. **Lightweight** — no external dependencies beyond the `ws` npm package.

### Non-Goals
1. Message persistence or replay (missed messages are lost).
2. Authentication or per-channel access control.
3. Client-to-server pub/sub (client sends messages via REST as usual).
4. Multiple WebSocket connections per client.
5. Binary message support (JSON only).

---

## 3) Protocol

All messages are JSON with a fixed envelope:

```ts
// Server → Client
interface PubSubMessage {
  channel: string;
  data: unknown;
}

// Client → Server
interface SubscribeMessage {
  action: "subscribe" | "unsubscribe";
  channel: string;
}
```

### Flow

1. Client opens WebSocket to `ws://host:port/ws/pubsub`.
2. Client sends `{ action: "subscribe", channel: "tasks" }`.
3. Server records that this connection is subscribed to `"tasks"`.
4. When any server code calls `publish("tasks", { ... })`, the message is sent to all connections subscribed to `"tasks"`.
5. Client can unsubscribe or simply close the connection.

---

## 4) Server API

```ts
interface IPubSub {
  /** Publish data to all clients subscribed to this channel. */
  publish(channel: string, data: unknown): void;
}

/** Attach WebSocket server to an existing HTTP server. Returns the pub/sub API. */
function createPubSub(server: http.Server): IPubSub;
```

### Usage

```ts
// server/index.ts
import { createPubSub } from "./pub-sub/index.js";

const httpServer = app.listen(PORT, "0.0.0.0", () => { ... });
const pubsub = createPubSub(httpServer);

// anywhere on the server
pubsub.publish("tasks", { event: "task.completed", taskId: "debug.counter" });
```

Note: `app.listen()` returns an `http.Server`, so no change to the existing server setup is needed.

---

## 5) Client API

A Vue composable:

```ts
type Unsubscribe = () => void;

function usePubSub(): {
  subscribe: (channel: string, callback: (data: unknown) => void) => Unsubscribe;
};
```

### Usage

```ts
const { subscribe } = usePubSub();

const unsub = subscribe("tasks", (data) => {
  console.log("task event:", data);
});

// later — removes only this callback, not other subscribers on the same channel
unsub();
```

### Connection Lifecycle

- The composable opens the WebSocket lazily on first `subscribe()` call.
- The connection is shared across all components (singleton).
- On WebSocket close, it reconnects automatically with exponential backoff (1s, 2s, 4s, capped at 30s). Active subscriptions are re-sent on reconnect.
- On Vue app unmount, the connection is closed.

---

## 6) Server Implementation

```ts
// server/pub-sub/index.ts

import { WebSocketServer, WebSocket } from "ws";
import http from "http";

function createPubSub(server: http.Server): IPubSub {
  const wss = new WebSocketServer({ server, path: "/ws/pubsub" });
  const subscriptions = new Map<WebSocket, Set<string>>();

  wss.on("connection", (ws) => {
    subscriptions.set(ws, new Set());

    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      const channels = subscriptions.get(ws)!;
      if (msg.action === "subscribe") channels.add(msg.channel);
      if (msg.action === "unsubscribe") channels.delete(msg.channel);
    });

    ws.on("close", () => {
      subscriptions.delete(ws);
    });
  });

  return {
    publish(channel, data) {
      const payload = JSON.stringify({ channel, data });
      for (const [ws, channels] of subscriptions) {
        if (channels.has(channel) && ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    },
  };
}
```

---

## 7) Client Implementation

```ts
// src/composables/usePubSub.ts

let ws: WebSocket | null = null;
const listeners = new Map<string, Set<(data: unknown) => void>>();

function ensureConnection() { /* connect, handle reconnect, re-subscribe */ }

function subscribe(channel: string, callback: (data: unknown) => void): () => void {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel)!.add(callback);
  ensureConnection();
  ws?.send(JSON.stringify({ action: "subscribe", channel }));

  // Return disposer that removes only this callback
  return () => {
    const cbs = listeners.get(channel);
    if (!cbs) return;
    cbs.delete(callback);
    // Unsubscribe from server only when no callbacks remain for this channel
    if (cbs.size === 0) {
      listeners.delete(channel);
      ws?.send(JSON.stringify({ action: "unsubscribe", channel }));
    }
  };
}

// On message: parse JSON, look up channel in listeners, call all callbacks.
```

---

## 8) File/Module Plan

```text
server/
  pub-sub/
    index.ts             // createPubSub + IPubSub type

src/
  composables/
    usePubSub.ts         // Vue composable (singleton WebSocket + subscribe/unsubscribe)
```

Dependencies to add: `ws` (+ `@types/ws` as dev dependency).

---

## 9) Integration with Task Manager

Once pub/sub is in place, the Task Manager can publish events:

```ts
// in task-manager tick logic, after a task completes:
pubsub.publish("tasks", { event: "task.completed", taskId: "debug.counter", count: 5 });
```

The client subscribes to `"tasks"` to display live status. This keeps the Task Manager decoupled from transport concerns — it just calls `publish()`.

---

## 10) Decision Summary

A single WebSocket at `/ws/pubsub` multiplexes all server-to-client push messages via named channels. The server gets a `publish(channel, data)` function; the client gets a `subscribe(channel, callback)` composable. No message persistence, no auth, no external dependencies beyond `ws`. The implementation is two files.
