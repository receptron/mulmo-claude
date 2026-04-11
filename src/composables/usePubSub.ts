interface PubSubMessage {
  channel: string;
  data: unknown;
}

type Callback = (data: unknown) => void;
type Unsubscribe = () => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

const listeners = new Map<string, Set<Callback>>();

function getWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/pubsub`;
}

function sendSubscriptions() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const channel of listeners.keys()) {
    ws.send(JSON.stringify({ action: "subscribe", channel }));
  }
}

function connect() {
  if (ws) return;

  const socket = new WebSocket(getWsUrl());

  socket.onopen = () => {
    reconnectDelay = 1000;
    sendSubscriptions();
  };

  socket.onmessage = (event) => {
    try {
      const msg: PubSubMessage = JSON.parse(String(event.data));
      const cbs = listeners.get(msg.channel);
      if (cbs) {
        for (const cb of cbs) {
          cb(msg.data);
        }
      }
    } catch {
      // Ignore malformed messages
    }
  };

  socket.onclose = () => {
    ws = null;
    if (listeners.size > 0) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    }
  };

  socket.onerror = () => {
    socket.close();
  };

  ws = socket;
}

export function usePubSub() {
  function subscribe(channel: string, callback: Callback): Unsubscribe {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(callback);
    connect();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "subscribe", channel }));
    }

    return () => {
      const cbs = listeners.get(channel);
      if (!cbs) return;
      cbs.delete(callback);
      if (cbs.size === 0) {
        listeners.delete(channel);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: "unsubscribe", channel }));
        }
      }

      // Close connection if no listeners remain
      if (listeners.size === 0) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (ws) {
          ws.close();
          ws = null;
        }
      }
    };
  }

  return { subscribe };
}
