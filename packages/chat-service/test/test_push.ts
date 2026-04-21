import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express from "express";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { attachChatSocket, CHAT_SOCKET_EVENTS, CHAT_SOCKET_PATH, type ChatSocketHandle } from "../src/socket.js";
import { createPushQueue } from "../src/push-queue.js";
import type { RelayResult } from "../src/relay.js";
import type { Logger } from "../src/types.js";

const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

const neverRelay = async (): Promise<RelayResult> => ({
  kind: "ok",
  reply: "(unused)",
});

interface Harness {
  httpServer: http.Server;
  handle: ChatSocketHandle;
  url: string;
  queueSizeFor: (transportId: string) => number;
}

async function startHarness(): Promise<Harness> {
  const app = express();
  const httpServer = http.createServer(app);
  const queue = createPushQueue();
  const handle = attachChatSocket(httpServer, {
    relay: neverRelay,
    queue,
    logger: silentLogger,
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }
  const url = `http://127.0.0.1:${address.port}`;

  return {
    httpServer,
    handle,
    url,
    queueSizeFor: (t) => queue.sizeFor(t),
  };
}

async function stopHarness(h: Harness): Promise<void> {
  await h.handle.io.close();
  await new Promise<void>((resolve) => h.httpServer.close(() => resolve()));
}

function connectClient(url: string, transportId: string = "cli"): ClientSocket {
  return ioClient(url, {
    path: CHAT_SOCKET_PATH,
    auth: { transportId },
    transports: ["websocket"],
    reconnection: false,
    timeout: 2000,
  });
}

function waitConnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (err) => reject(err));
  });
}

interface PushEvent {
  chatId: string;
  message: string;
}

function collectPushes(socket: ClientSocket, count: number, timeoutMs = 1000): Promise<PushEvent[]> {
  return new Promise((resolve, reject) => {
    const received: PushEvent[] = [];
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${count} pushes; got ${received.length}`)), timeoutMs);
    socket.on(CHAT_SOCKET_EVENTS.push, (ev: PushEvent) => {
      received.push(ev);
      if (received.length >= count) {
        clearTimeout(timer);
        resolve(received);
      }
    });
  });
}

describe("pushToBridge — live", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await stopHarness(harness);
  });

  it("delivers to a connected bridge", async () => {
    const client = connectClient(harness.url);
    await waitConnect(client);

    const pushes = collectPushes(client, 1);
    harness.handle.pushToBridge("cli", "terminal", "hello");

    const [evt] = await pushes;
    assert.equal(evt.chatId, "terminal");
    assert.equal(evt.message, "hello");
    assert.equal(harness.queueSizeFor("cli"), 0);

    client.disconnect();
  });

  it("broadcasts to every socket in the transport room", async () => {
    const a = connectClient(harness.url);
    const b = connectClient(harness.url);
    await Promise.all([waitConnect(a), waitConnect(b)]);

    const aPushes = collectPushes(a, 1);
    const bPushes = collectPushes(b, 1);

    harness.handle.pushToBridge("cli", "terminal", "shared");

    const [[aEvt], [bEvt]] = await Promise.all([aPushes, bPushes]);
    assert.equal(aEvt.message, "shared");
    assert.equal(bEvt.message, "shared");

    a.disconnect();
    b.disconnect();
  });

  it("does not deliver to a different transport", async () => {
    const cli = connectClient(harness.url, "cli");
    await waitConnect(cli);

    let received = false;
    cli.on(CHAT_SOCKET_EVENTS.push, () => {
      received = true;
    });
    harness.handle.pushToBridge("telegram", "chat-99", "not for cli");
    // Give socket.io time to decide not to deliver.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(received, false);
    // Queued for the absent telegram bridge.
    assert.equal(harness.queueSizeFor("telegram"), 1);

    cli.disconnect();
  });
});

describe("pushToBridge — offline queue + flush on reconnect", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await stopHarness(harness);
  });

  it("queues when no bridge is connected", () => {
    harness.handle.pushToBridge("cli", "terminal", "first");
    harness.handle.pushToBridge("cli", "terminal", "second");
    assert.equal(harness.queueSizeFor("cli"), 2);
  });

  it("flushes the queue to the joining socket on connect", async () => {
    harness.handle.pushToBridge("cli", "terminal", "queued-1");
    harness.handle.pushToBridge("cli", "terminal", "queued-2");
    assert.equal(harness.queueSizeFor("cli"), 2);

    const client = connectClient(harness.url);
    const pushes = collectPushes(client, 2);
    await waitConnect(client);

    const received = await pushes;
    assert.deepEqual(
      received.map((e) => e.message),
      ["queued-1", "queued-2"],
    );
    assert.equal(harness.queueSizeFor("cli"), 0);

    client.disconnect();
  });

  it("only flushes to the first joining socket (no duplicate delivery)", async () => {
    harness.handle.pushToBridge("cli", "terminal", "once");

    // First socket connects and drains.
    const a = connectClient(harness.url);
    const firstPush = collectPushes(a, 1);
    await waitConnect(a);
    const [aEvt] = await firstPush;
    assert.equal(aEvt.message, "once");
    assert.equal(harness.queueSizeFor("cli"), 0);

    // Second socket joins after the drain — should get nothing.
    const b = connectClient(harness.url);
    let bReceived = false;
    b.on(CHAT_SOCKET_EVENTS.push, () => {
      bReceived = true;
    });
    await waitConnect(b);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(bReceived, false);

    a.disconnect();
    b.disconnect();
  });

  it("survives disconnect → reconnect (new queue → flush)", async () => {
    const a = connectClient(harness.url);
    await waitConnect(a);
    a.disconnect();
    // Give server time to mark the room empty.
    await new Promise((r) => setTimeout(r, 50));

    // No live bridge — push queues.
    harness.handle.pushToBridge("cli", "terminal", "while-away");
    assert.equal(harness.queueSizeFor("cli"), 1);

    const b = connectClient(harness.url);
    const pushes = collectPushes(b, 1);
    await waitConnect(b);
    const [evt] = await pushes;
    assert.equal(evt.message, "while-away");
    b.disconnect();
  });
});
