import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express from "express";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { Server as SocketServer } from "socket.io";
import {
  attachChatSocket,
  CHAT_SOCKET_PATH,
} from "../../server/chat-service/socket.ts";
import type {
  RelayParams,
  RelayResult,
} from "../../server/chat-service/relay.ts";
import type { Logger } from "../../server/chat-service/types.ts";

const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

interface Harness {
  httpServer: http.Server;
  io: SocketServer;
  url: string;
  relayCalls: RelayParams[];
  setRelayResult: (result: RelayResult) => void;
}

async function startHarness(): Promise<Harness> {
  const app = express();
  const httpServer = http.createServer(app);
  const relayCalls: RelayParams[] = [];
  let nextResult: RelayResult = { kind: "ok", reply: "default" };

  const io = attachChatSocket(httpServer, {
    relay: async (params) => {
      relayCalls.push(params);
      return nextResult;
    },
    logger: silentLogger,
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

function connectClient(url: string, transportId: unknown): ClientSocket {
  return ioClient(url, {
    path: CHAT_SOCKET_PATH,
    auth: transportId === undefined ? {} : { transportId },
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

describe("chat-service socket", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await stopHarness(harness);
  });

  it("accepts a message and invokes the ack with the reply", async () => {
    harness.setRelayResult({ kind: "ok", reply: "hello back" });
    const client = connectClient(harness.url, "cli");
    await waitConnect(client);

    const ack = await new Promise<{
      ok: boolean;
      reply?: string;
      error?: string;
    }>((resolve) => {
      client.emit(
        "message",
        { externalChatId: "terminal", text: "hi" },
        resolve,
      );
    });

    assert.deepEqual(ack, { ok: true, reply: "hello back" });
    assert.equal(harness.relayCalls.length, 1);
    assert.deepEqual(harness.relayCalls[0], {
      transportId: "cli",
      externalChatId: "terminal",
      text: "hi",
    });

    client.disconnect();
  });

  it("rejects the handshake when transportId is missing", async () => {
    const client = connectClient(harness.url, undefined);

    await assert.rejects(waitConnect(client), /transportId is required/);
    client.disconnect();
  });

  it("returns a 400 ack when externalChatId is missing", async () => {
    const client = connectClient(harness.url, "cli");
    await waitConnect(client);

    const ack = await new Promise<{
      ok: boolean;
      error?: string;
      status?: number;
    }>((resolve) => {
      client.emit("message", { text: "hi" }, resolve);
    });

    assert.equal(ack.ok, false);
    assert.equal(ack.status, 400);
    assert.match(ack.error ?? "", /externalChatId/);
    assert.equal(harness.relayCalls.length, 0);

    client.disconnect();
  });

  it("returns a 400 ack when text is empty", async () => {
    const client = connectClient(harness.url, "cli");
    await waitConnect(client);

    const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
      client.emit(
        "message",
        { externalChatId: "terminal", text: "   " },
        resolve,
      ),
    );

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
    const client = connectClient(harness.url, "cli");
    await waitConnect(client);

    const ack = await new Promise<{
      ok: boolean;
      error?: string;
      status?: number;
    }>((resolve) =>
      client.emit(
        "message",
        { externalChatId: "terminal", text: "hi" },
        resolve,
      ),
    );

    assert.deepEqual(ack, { ok: false, error: "Error: boom", status: 500 });
    client.disconnect();
  });
});
