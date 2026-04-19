import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express from "express";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { Server as SocketServer } from "socket.io";
import {
  attachChatSocket,
  CHAT_SOCKET_EVENTS,
  CHAT_SOCKET_PATH,
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

interface HarnessOpts {
  tokenProvider?: () => string | null;
}

interface Harness {
  httpServer: http.Server;
  io: SocketServer;
  url: string;
  relayCalls: RelayParams[];
  setRelayResult: (result: RelayResult) => void;
}

async function startHarness(opts: HarnessOpts = {}): Promise<Harness> {
  const app = express();
  const httpServer = http.createServer(app);
  const relayCalls: RelayParams[] = [];
  let nextResult: RelayResult = { kind: "ok", reply: "default" };

  const { io } = attachChatSocket(httpServer, {
    relay: async (params) => {
      relayCalls.push(params);
      return nextResult;
    },
    queue: createPushQueue(),
    logger: silentLogger,
    tokenProvider: opts.tokenProvider,
  });

  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server address");
  }
  const url = `http://127.0.0.1:${address.port}`;

  return {
    httpServer,
    io,
    url,
    relayCalls,
    setRelayResult: (r) => {
      nextResult = r;
    },
  };
}

async function stopHarness(h: Harness): Promise<void> {
  await h.io.close();
  await new Promise<void>((resolve) => h.httpServer.close(() => resolve()));
}

function connectClient(
  url: string,
  auth: Record<string, unknown> | undefined,
): ClientSocket {
  return ioClient(url, {
    path: CHAT_SOCKET_PATH,
    auth: auth ?? {},
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

function emitMessage(
  client: ClientSocket,
  payload: unknown,
): Promise<{ ok: boolean; reply?: string; error?: string; status?: number }> {
  return new Promise((resolve) => {
    client.emit(CHAT_SOCKET_EVENTS.message, payload, resolve);
  });
}

describe("chat-service socket — no auth", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await stopHarness(harness);
  });

  it("accepts a message and invokes the ack with the reply", async () => {
    harness.setRelayResult({ kind: "ok", reply: "hello back" });
    const client = connectClient(harness.url, { transportId: "cli" });
    await waitConnect(client);

    const ack = await emitMessage(client, {
      externalChatId: "terminal",
      text: "hi",
    });

    assert.deepEqual(ack, { ok: true, reply: "hello back" });
    assert.equal(harness.relayCalls.length, 1);
    assert.equal(harness.relayCalls[0].transportId, "cli");
    assert.equal(harness.relayCalls[0].externalChatId, "terminal");
    assert.equal(harness.relayCalls[0].text, "hi");

    client.disconnect();
  });

  it("rejects the handshake when transportId is missing", async () => {
    const client = connectClient(harness.url, {});
    await assert.rejects(waitConnect(client), /transportId is required/);
    client.disconnect();
  });

  it("returns a 400 ack when externalChatId is missing", async () => {
    const client = connectClient(harness.url, { transportId: "cli" });
    await waitConnect(client);

    const ack = await emitMessage(client, { text: "hi" });

    assert.equal(ack.ok, false);
    assert.equal(ack.status, 400);
    assert.match(ack.error ?? "", /externalChatId/);
    assert.equal(harness.relayCalls.length, 0);

    client.disconnect();
  });

  it("returns a 400 ack when text is empty", async () => {
    const client = connectClient(harness.url, { transportId: "cli" });
    await waitConnect(client);

    const ack = await emitMessage(client, {
      externalChatId: "terminal",
      text: "   ",
    });

    assert.equal(ack.ok, false);
    assert.match(ack.error ?? "", /text is required/);
    assert.equal(harness.relayCalls.length, 0);

    client.disconnect();
  });

  it("propagates relay errors back as ack with status", async () => {
    harness.setRelayResult({
      kind: "error",
      status: 500,
      message: "Error: boom",
    });
    const client = connectClient(harness.url, { transportId: "cli" });
    await waitConnect(client);

    const ack = await emitMessage(client, {
      externalChatId: "terminal",
      text: "hi",
    });

    assert.deepEqual(ack, { ok: false, error: "Error: boom", status: 500 });
    client.disconnect();
  });
});

describe("chat-service socket — bearer token", () => {
  const EXPECTED = "test-token-xyz";
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness({ tokenProvider: () => EXPECTED });
  });

  afterEach(async () => {
    await stopHarness(harness);
  });

  it("accepts a handshake with matching token", async () => {
    const client = connectClient(harness.url, {
      transportId: "cli",
      token: EXPECTED,
    });
    await waitConnect(client);

    const ack = await emitMessage(client, {
      externalChatId: "terminal",
      text: "hi",
    });
    assert.equal(ack.ok, true);
    client.disconnect();
  });

  it("rejects when token is missing", async () => {
    const client = connectClient(harness.url, { transportId: "cli" });
    await assert.rejects(waitConnect(client), /token is required/);
    client.disconnect();
  });

  it("rejects when token is wrong", async () => {
    const client = connectClient(harness.url, {
      transportId: "cli",
      token: "not-the-right-one",
    });
    await assert.rejects(waitConnect(client), /invalid token/);
    client.disconnect();
  });

  it("rejects when server auth is not bootstrapped", async () => {
    await stopHarness(harness);
    harness = await startHarness({ tokenProvider: () => null });
    const client = connectClient(harness.url, {
      transportId: "cli",
      token: EXPECTED,
    });
    await assert.rejects(waitConnect(client), /server auth not ready/);
    client.disconnect();
  });
});
