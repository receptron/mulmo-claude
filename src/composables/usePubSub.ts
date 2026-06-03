import { io, type Socket } from "socket.io-client";

interface PubSubMessage {
  channel: string;
  data: unknown;
}

type Callback = (data: unknown) => void;
type Unsubscribe = () => void;

// E2E runs the Vite client with no backend (`yarn dev:client:e2e` sets
// VITE_E2E=1) — HTTP is mocked at the Playwright layer, but the pubsub
// socket would still dial `ws://localhost:3001` and spew ECONNREFUSED
// reconnect noise. No live events arrive in e2e anyway, so skip the
// socket entirely: subscriptions become no-ops.
const PUBSUB_DISABLED = import.meta.env.VITE_E2E === "1";

// On reconnect we re-emit every live subscription so the rooms list survives the bounce.
let socket: Socket | null = null;

const listeners = new Map<string, Set<Callback>>();

function resendSubscriptions(sock: Socket): void {
  for (const channel of listeners.keys()) {
    sock.emit("subscribe", channel);
  }
}

function connect(): Socket {
  if (socket) return socket;

  const sock = io({
    path: "/ws/pubsub",
    // Server refuses long-polling fallback, so fail fast here too if the WS upgrade doesn't go through.
    transports: ["websocket"],
  });

  sock.on("connect", () => resendSubscriptions(sock));

  sock.on("data", (msg: PubSubMessage) => {
    const cbs = listeners.get(msg.channel);
    if (cbs) {
      for (const handler of cbs) handler(msg.data);
    }
  });

  socket = sock;
  return sock;
}

function maybeDisconnect(): void {
  if (listeners.size > 0) return;
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

export function usePubSub() {
  function subscribe(channel: string, callback: Callback): Unsubscribe {
    // No backend in e2e — never open the socket (see PUBSUB_DISABLED).
    if (PUBSUB_DISABLED) return () => {};

    let entry = listeners.get(channel);
    if (!entry) {
      entry = new Set();
      listeners.set(channel, entry);
    }
    entry.add(callback);

    const sock = connect();
    if (sock.connected) sock.emit("subscribe", channel);
    // If not yet connected, the "connect" handler replays every subscription — no extra bookkeeping needed.

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
