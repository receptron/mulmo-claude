// MulmoBridge Relay WebSocket client.
//
// Connects to the Relay (Cloudflare Workers) and forwards incoming
// platform messages to the chat-service relay function. Handles
// reconnection with exponential backoff. Uses the `ws` npm package,
// so it is Node-only — there is no longer a browser/edge counterpart.

import WebSocket from "ws";
import type { ChatService } from "@mulmobridge/chat-service";
import { ONE_SECOND_MS } from "../utils/time.js";
import { errorMessage } from "../utils/errors.js";
import { resolveRelayBridgeOptions } from "./resolveRelayBridgeOptions.js";
import {
  buildExternalChatId,
  buildRelayUrl,
  formatReplyText,
  isRelayMessage,
  isTerminalCloseCode,
  nextReconnectMs,
  type RelayMessage,
} from "./relay-client-helpers.js";

type RelayFn = ChatService["relay"];

// ── Types ────────────────────────────────────────────────────

interface RelayResponse {
  platform: string;
  chatId: string;
  text: string;
  replyToken?: string;
}

interface Logger {
  info: (prefix: string, msg: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, msg: string, data?: Record<string, unknown>) => void;
  error: (prefix: string, msg: string, data?: Record<string, unknown>) => void;
}

// `ws` hands the listener `Buffer | ArrayBuffer | Buffer[]`. The default
// binaryType is nodebuffer so a Buffer is what actually arrives, but the type
// admits ArrayBuffer — whose `toString()` is the literal "[object ArrayBuffer]",
// i.e. a frame silently parsed as garbage. Normalise instead of trusting the
// runtime default to hold.
const frameText = (data: Buffer | ArrayBuffer | Buffer[]): string =>
  Buffer.isBuffer(data) ? data.toString("utf8") : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data).toString("utf8");

export interface RelayClientDeps {
  relayUrl: string;
  relayToken: string;
  relay: RelayFn;
  logger: Logger;
}

export interface RelayClientHandle {
  disconnect: () => void;
}

// ── Constants ────────────────────────────────────────────────

const LOG_PREFIX = "relay-client";
const TRANSPORT_ID = "relay";
const MIN_RECONNECT_MS = ONE_SECOND_MS;
const MAX_RECONNECT_MS = 30 * ONE_SECOND_MS;
const MAX_RESPONSE_QUEUE = 100;

// ── Incoming message handling ────────────────────────────────

interface HandleRelayMessageDeps {
  relay: RelayFn;
  logger: Logger;
  sendResponse: (response: RelayResponse) => void;
}

function replyTo(msg: RelayMessage, text: string, sendResponse: (response: RelayResponse) => void): void {
  sendResponse({
    platform: msg.platform,
    chatId: msg.chatId,
    text,
    replyToken: msg.replyToken,
  });
}

// Parse one raw relay frame, forward it to the chat-service relay
// function, and ship the reply back. Closes over no socket / timer /
// mutable state, so it is unit-testable in isolation.
export async function handleRelayMessage(raw: string, deps: HandleRelayMessageDeps): Promise<void> {
  const { relay, logger, sendResponse } = deps;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(LOG_PREFIX, "invalid JSON from relay", {
      length: raw.length,
    });
    return;
  }

  if (!isRelayMessage(parsed)) {
    logger.warn(LOG_PREFIX, "malformed relay message");
    return;
  }
  const msg = parsed;

  logger.info(LOG_PREFIX, "message received", {
    id: msg.id,
    platform: msg.platform,
    chatId: msg.chatId,
    textLength: msg.text.length,
  });

  const externalChatId = buildExternalChatId(msg.platform, msg.chatId);

  try {
    // Per-platform default-role resolution (#739). Mirrors the
    // bridges-side handshake (#729): each platform can pin its own
    // default role via `RELAY_<PLATFORM>_DEFAULT_ROLE`, with
    // `RELAY_DEFAULT_ROLE` as the blanket fallback. The helper
    // never forwards `RELAY_TOKEN` / `RELAY_URL` — they aren't on
    // the recognised-keys allowlist.
    const bridgeOptions = resolveRelayBridgeOptions(msg.platform, process.env);
    const result = await relay({
      transportId: TRANSPORT_ID,
      externalChatId,
      text: msg.text,
      bridgeOptions,
    });

    replyTo(msg, formatReplyText(result), sendResponse);
  } catch (err) {
    logger.error(LOG_PREFIX, "relay processing failed", {
      id: msg.id,
      error: errorMessage(err),
    });
    replyTo(msg, "Error: failed to process message", sendResponse);
  }
}

// ── Response queue ───────────────────────────────────────────

interface ResponseQueue {
  enqueue: (response: RelayResponse) => void;
  send: (response: RelayResponse) => void;
  flush: () => void;
}

interface ResponseQueueDeps {
  logger: Logger;
  trySend: (response: RelayResponse) => boolean;
}

// A bounded FIFO of outgoing responses that owns its own buffer. The
// live socket stays in the parent; `trySend` is injected as the
// transport strategy (it returns false when the socket is missing /
// not OPEN), so the queue never touches the socket directly.
export function createResponseQueue(deps: ResponseQueueDeps): ResponseQueue {
  const { logger, trySend } = deps;
  const responseQueue: RelayResponse[] = [];

  function enqueue(response: RelayResponse): void {
    if (responseQueue.length >= MAX_RESPONSE_QUEUE) {
      logger.error(LOG_PREFIX, "response queue full, dropping oldest", {
        platform: response.platform,
        chatId: response.chatId,
      });
      responseQueue.shift();
    }
    responseQueue.push(response);
  }

  function send(response: RelayResponse): void {
    if (trySend(response)) return;
    enqueue(response);
    logger.error(LOG_PREFIX, "response queued (not connected)", {
      platform: response.platform,
      chatId: response.chatId,
      queueSize: responseQueue.length,
    });
  }

  function flush(): void {
    if (responseQueue.length === 0) return;
    logger.info(LOG_PREFIX, "flushing response queue", {
      count: responseQueue.length,
    });
    // `trySend` returns false when the socket isn't OPEN, so it alone
    // gates the drain — stop at the first response we can't send and
    // leave it (plus the rest) queued for the next flush.
    while (responseQueue.length > 0) {
      const [response] = responseQueue;
      if (!trySend(response)) break;
      responseQueue.shift();
    }
  }

  return { enqueue, send, flush };
}

// ── Socket wiring ───────────────────────────────────────────

// Mutable state shared across the factory's helpers. Kept as a single object
// so the module-scope helpers can be typed against one shape rather than
// threading each field through their signatures.
export interface RelayState {
  socket: WebSocket | null;
  reconnectMs: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

// Try to write `response` over the live socket. Returns false when there is
// no socket or it isn't OPEN (caller queues instead). On a write error the
// callback re-enqueues via `onEnqueue`; a synchronous throw (rare, e.g. socket
// already CLOSED between the OPEN check and .send) is caught and reported as
// "not sent" so the caller can queue.
export function attemptSocketSend(state: RelayState, response: RelayResponse, logger: Logger, onEnqueue: () => void): boolean {
  const live = state.socket;
  if (!live || live.readyState !== WebSocket.OPEN) return false;
  try {
    live.send(JSON.stringify(response), (err) => {
      if (err && !state.stopped) {
        logger.warn(LOG_PREFIX, "send failed, requeueing", { platform: response.platform, chatId: response.chatId, error: err.message });
        onEnqueue();
      }
    });
    return true;
  } catch {
    return false;
  }
}

// Arm the exponential-backoff reconnect timer. No-op after `stopRelay` set
// `stopped` — otherwise a fire-in-flight timer would resurrect the socket
// after a manual disconnect.
function scheduleReconnectStep(state: RelayState, logger: Logger, connect: () => void): void {
  if (state.stopped) return;
  logger.info(LOG_PREFIX, "reconnecting", { delayMs: state.reconnectMs });
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, state.reconnectMs);
  state.reconnectMs = nextReconnectMs(state.reconnectMs, MAX_RECONNECT_MS);
}

// Manual shutdown. `stopped = true` MUST happen before `socket.close()` — the
// close event will still fire, and without the guard the close handler would
// schedule a reconnect after we asked to stop.
export function stopRelay(state: RelayState, logger: Logger): void {
  state.stopped = true;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.socket) {
    state.socket.close(1000, "shutdown");
    state.socket = null;
  }
  logger.info(LOG_PREFIX, "stopped");
}

interface AttachSocketHandlersDeps {
  relayUrl: string;
  logger: Logger;
  relay: RelayFn;
  queue: ResponseQueue;
  onOpen: () => void;
  onCloseAny: () => void;
  onCloseTransient: () => void;
}

// Attaches open / message / close / error listeners to a live socket. The
// close handler branches by `isTerminalCloseCode`; the caller supplies
// `onCloseAny` (always fires — used to null the parent's `socket` ref) and
// `onCloseTransient` (fires only on a non-terminal close — used to schedule
// reconnect). Kept at module scope so `connectRelay` stays under the
// per-function line cap.
function attachSocketHandlers(socket: WebSocket, deps: AttachSocketHandlersDeps): void {
  const { relayUrl, logger, relay, queue, onOpen, onCloseAny, onCloseTransient } = deps;

  socket.on("open", () => {
    logger.info(LOG_PREFIX, "connected", { url: relayUrl });
    onOpen();
    queue.flush();
  });

  socket.on("message", (data) => {
    // One bad message must not take the socket down: `handleRelayMessage`
    // already logs the failures it anticipates, so anything reaching here is
    // unexpected and only needs to be recorded, not propagated.
    void handleRelayMessage(frameText(data), { relay, logger, sendResponse: queue.send }).catch((err: unknown) => {
      logger.error(LOG_PREFIX, "relay message handler threw", { error: String(err) });
    });
  });

  socket.on("close", (code, reason) => {
    onCloseAny();
    if (isTerminalCloseCode(code)) {
      logger.error(LOG_PREFIX, "terminal close, not reconnecting", { code, reason: String(reason) });
      return;
    }
    logger.info(LOG_PREFIX, "disconnected", { code, reason: String(reason) });
    onCloseTransient();
  });

  socket.on("error", (err) => {
    logger.warn(LOG_PREFIX, "connection error", { error: err.message });
    // close event will follow, triggering reconnect
  });
}

// ── Factory ─────────────────────────────────────────────────

export function connectRelay(deps: RelayClientDeps): RelayClientHandle {
  const { relayUrl, relayToken, relay, logger } = deps;
  const state: RelayState = { socket: null, reconnectMs: MIN_RECONNECT_MS, reconnectTimer: null, stopped: false };
  const queue = createResponseQueue({
    logger,
    trySend: (response) => attemptSocketSend(state, response, logger, () => queue.enqueue(response)),
  });
  function scheduleReconnect(): void {
    scheduleReconnectStep(state, logger, connect);
  }
  function connect(): void {
    if (state.stopped) return;
    try {
      state.socket = new WebSocket(buildRelayUrl(relayUrl, relayToken));
    } catch (err) {
      logger.error(LOG_PREFIX, "failed to create WebSocket", { error: errorMessage(err) });
      scheduleReconnect();
      return;
    }
    attachSocketHandlers(state.socket, {
      relayUrl,
      logger,
      relay,
      queue,
      onOpen: () => {
        state.reconnectMs = MIN_RECONNECT_MS;
      },
      onCloseAny: () => {
        state.socket = null;
      },
      onCloseTransient: scheduleReconnect,
    });
  }
  connect();
  return { disconnect: () => stopRelay(state, logger) };
}
