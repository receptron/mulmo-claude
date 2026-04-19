import { io, type Socket } from "socket.io-client";

interface PubSubMessage {
  channel: string;
  data: unknown;
}

type Callback = (data: unknown) => void;
type Unsubscribe = () => void;

// Socket.IO replaces the raw WebSocket + hand-rolled reconnect
// state machine. One multiplexed connection; channels map to
// socket.io rooms via `subscribe` / `unsubscribe` events.
//
// Reconnect / backoff / heartbeat are all handled by socket.io,
// so there's no reconnectTimer / reconnectDelay here anymore. On
// reconnect, `connect` fires again and we re-send every
// subscription the client still cares about.

let socket: Socket | null = null;

const listeners = new Map<string, Set<Callback>>();

function resendSubscriptions(s: Socket): void {
  for (const channel of listeners.keys()) {
    s.emit("subscribe", channel);
  }
}

function connect(): Socket {
  if (socket) return socket;

  const s = io({
    path: "/ws/pubsub",
    // Match the server. Long-polling is fine as a fallback but
    // the server refuses it, so don't negotiate it here either —
    // fail fast if the WS upgrade doesn't go through.
    transports: ["websocket"],
  });

  s.on("connect", () => resendSubscriptions(s));

  s.on("data", (msg: PubSubMessage) => {
    const cbs = listeners.get(msg.channel);
    if (cbs) {
      for (const cb of cbs) cb(msg.data);
    }
  });

  socket = s;
  return s;
}

function maybeDisconnect(): void {
  if (listeners.size > 0) return;
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

export function usePubSub() {
  function subscribe(channel: string, callback: Callback): Unsubscribe {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback);

    const s = connect();
    if (s.connected) s.emit("subscribe", channel);
    // If not yet connected, the "connect" handler replays every
    // listener's subscription, so newly-added channels are
    // covered without extra bookkeeping.

    return () => {
      const cbs = listeners.get(channel);
      if (!cbs) return;
      cbs.delete(callback);
      if (cbs.size === 0) {
        listeners.delete(channel);
        if (socket?.connected) socket.emit("unsubscribe", channel);
      }
      maybeDisconnect();
    };
  }

  return { subscribe };
}
