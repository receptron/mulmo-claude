// Integration test for text streaming (Phase C of #268).
//
// Spins up a real chat-service socket.io server with a mock relay
// that emits text chunks via the onChunk callback, then connects a
// bridge client and verifies:
//   1. textChunk events arrive in real time (before the ack)
//   2. Chunks arrive in order
//   3. The ack carries the full accumulated text
//   4. When no chunks are emitted, the ack still works (fallback)

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express from "express";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import {
  attachChatSocket,
  CHAT_SOCKET_EVENTS,
  CHAT_SOCKET_PATH,
  type ChatSocketHandle,
} from "../src/socket.js";
import { createPushQueue } from "../src/push-queue.js";
import type { RelayParams, RelayResult } from "../src/relay.js";
import type { Logger } from "../src/types.js";

const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

interface Harness {
  httpServer: http.Server;
  handle: ChatSocketHandle;
  url: string;
}

type RelayFn = (params: RelayParams) => Promise<RelayResult>;

async function startHarness(relay: RelayFn): Promise<Harness> {
  const app = express();
  const httpServer = http.createServer(app);
  const handle = attachChatSocket(httpServer, {
    relay,
    queue: createPushQueue(),
    logger: silentLogger,
  });

  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }

  return {
    httpServer,
    handle,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function stopHarness(h: Harness): Promise<void> {
  await h.handle.io.close();
  await new Promise<void>((resolve) => h.httpServer.close(() => resolve()));
}

function connectClient(url: string, transportId = "test"): ClientSocket {
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

describe("text streaming (Phase C)", () => {
  let harness: Harness;
  let client: ClientSocket;

  afterEach(async () => {
    client?.disconnect();
    if (harness) await stopHarness(harness);
  });

  it("emits textChunk events for each chunk before the ack", async () => {
    // Relay that sends 3 chunks via onChunk, then returns full text
    harness = await startHarness(async (params) => {
      params.onChunk?.("Hello ");
      params.onChunk?.("beautiful ");
      params.onChunk?.("world!");
      return { kind: "ok", reply: "Hello beautiful world!" };
    });

    client = connectClient(harness.url);
    await waitConnect(client);

    const chunks: string[] = [];
    client.on(CHAT_SOCKET_EVENTS.textChunk, (event: { text: string }) => {
      chunks.push(event.text);
    });

    // Send message and wait for ack
    const ack = await new Promise<{
      ok: boolean;
      reply?: string;
    }>((resolve) => {
      client
        .timeout(5000)
        .emit(
          CHAT_SOCKET_EVENTS.message,
          { externalChatId: "test-chat", text: "hello" },
          (_err: Error | null, response: { ok: boolean; reply?: string }) => {
            resolve(response);
          },
        );
    });

    // Verify chunks arrived
    assert.deepEqual(chunks, ["Hello ", "beautiful ", "world!"]);
    // Verify ack has full text
    assert.equal(ack.ok, true);
    assert.equal(ack.reply, "Hello beautiful world!");
  });

  it("works without chunks (backward compatibility)", async () => {
    // Relay that does NOT call onChunk — simulates no streaming
    harness = await startHarness(async () => {
      return { kind: "ok", reply: "no streaming reply" };
    });

    client = connectClient(harness.url);
    await waitConnect(client);

    const chunks: string[] = [];
    client.on(CHAT_SOCKET_EVENTS.textChunk, (event: { text: string }) => {
      chunks.push(event.text);
    });

    const ack = await new Promise<{
      ok: boolean;
      reply?: string;
    }>((resolve) => {
      client
        .timeout(5000)
        .emit(
          CHAT_SOCKET_EVENTS.message,
          { externalChatId: "test-chat", text: "hi" },
          (_err: Error | null, response: { ok: boolean; reply?: string }) => {
            resolve(response);
          },
        );
    });

    // No chunks emitted
    assert.equal(chunks.length, 0);
    // Ack still works
    assert.equal(ack.ok, true);
    assert.equal(ack.reply, "no streaming reply");
  });

  it("handles error relay without chunks", async () => {
    harness = await startHarness(async () => {
      return { kind: "error", status: 500, message: "internal error" };
    });

    client = connectClient(harness.url);
    await waitConnect(client);

    const chunks: string[] = [];
    client.on(CHAT_SOCKET_EVENTS.textChunk, (event: { text: string }) => {
      chunks.push(event.text);
    });

    const ack = await new Promise<{
      ok: boolean;
      error?: string;
      status?: number;
    }>((resolve) => {
      client
        .timeout(5000)
        .emit(
          CHAT_SOCKET_EVENTS.message,
          { externalChatId: "test-chat", text: "fail" },
          (
            _err: Error | null,
            response: { ok: boolean; error?: string; status?: number },
          ) => {
            resolve(response);
          },
        );
    });

    assert.equal(chunks.length, 0);
    assert.equal(ack.ok, false);
    assert.equal(ack.error, "internal error");
    assert.equal(ack.status, 500);
  });

  it("streams chunks to the correct socket only (not broadcast)", async () => {
    harness = await startHarness(async (params) => {
      params.onChunk?.("for you only");
      return { kind: "ok", reply: "for you only" };
    });

    // Two clients connect
    const clientA = connectClient(harness.url, "bridge-a");
    const clientB = connectClient(harness.url, "bridge-b");
    await Promise.all([waitConnect(clientA), waitConnect(clientB)]);

    const chunksA: string[] = [];
    const chunksB: string[] = [];
    clientA.on(CHAT_SOCKET_EVENTS.textChunk, (event: { text: string }) => {
      chunksA.push(event.text);
    });
    clientB.on(CHAT_SOCKET_EVENTS.textChunk, (event: { text: string }) => {
      chunksB.push(event.text);
    });

    // Only clientA sends a message
    await new Promise<void>((resolve) => {
      clientA
        .timeout(5000)
        .emit(
          CHAT_SOCKET_EVENTS.message,
          { externalChatId: "chat", text: "test" },
          () => resolve(),
        );
    });

    // Only clientA should get chunks
    assert.deepEqual(chunksA, ["for you only"]);
    // clientB should get nothing (different transport, didn't send)
    assert.equal(chunksB.length, 0);

    clientA.disconnect();
    clientB.disconnect();
    client = null as unknown as ClientSocket; // skip afterEach disconnect
  });
});
