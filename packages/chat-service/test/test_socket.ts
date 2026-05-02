import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import express from "express";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { Server as SocketServer } from "socket.io";
import { attachChatSocket, CHAT_SOCKET_EVENTS, CHAT_SOCKET_PATH, parseOneAttachment } from "../src/socket.js";
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

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
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

function connectClient(url: string, auth: Record<string, unknown> | undefined): ClientSocket {
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

function emitMessage(client: ClientSocket, payload: unknown): Promise<{ ok: boolean; reply?: string; error?: string; status?: number }> {
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

  it("forwards a path-only attachment to relay unchanged (#1099)", async () => {
    // Regression for #1050: the socket parser was inline-only and
    // silently dropped `{ path }` payloads. Pin the wire shape so a
    // future refactor can't reintroduce the drop.
    const client = connectClient(harness.url, { transportId: "cli" });
    await waitConnect(client);
    const ack = await emitMessage(client, {
      externalChatId: "terminal",
      text: "look at this",
      attachments: [{ path: "data/attachments/2026/05/x.png", mimeType: "image/png" }],
    });
    assert.equal(ack.ok, true);
    assert.equal(harness.relayCalls.length, 1);
    assert.deepEqual(harness.relayCalls[0].attachments, [{ path: "data/attachments/2026/05/x.png", mimeType: "image/png" }]);
    client.disconnect();
  });

  it("forwards only the valid entries when the array mixes valid + invalid items", async () => {
    const client = connectClient(harness.url, { transportId: "cli" });
    await waitConnect(client);
    const ack = await emitMessage(client, {
      externalChatId: "terminal",
      text: "mixed bag",
      attachments: [
        { path: "data/attachments/2026/05/a.png" },
        { somethingElse: "wrong shape" },
        { mimeType: "image/png" /* missing data + path */ },
        { mimeType: "image/png", data: "AAAA" },
      ],
    });
    assert.equal(ack.ok, true);
    const forwarded = harness.relayCalls[0].attachments ?? [];
    assert.equal(forwarded.length, 2);
    assert.equal(forwarded[0].path, "data/attachments/2026/05/a.png");
    assert.equal(forwarded[1].data, "AAAA");
    client.disconnect();
  });
});

describe("chat-service socket — parseOneAttachment", () => {
  it("accepts the inline `{ data, mimeType }` shape", () => {
    assert.deepEqual(parseOneAttachment({ mimeType: "image/png", data: "AAAA" }), { mimeType: "image/png", data: "AAAA" });
  });

  it("accepts the path-only `{ path }` shape", () => {
    assert.deepEqual(parseOneAttachment({ path: "data/attachments/2026/05/x.png" }), { path: "data/attachments/2026/05/x.png" });
  });

  it("preserves optional `filename` and `mimeType` on path-only entries", () => {
    assert.deepEqual(parseOneAttachment({ path: "data/attachments/2026/05/x.png", mimeType: "image/png", filename: "x.png" }), {
      path: "data/attachments/2026/05/x.png",
      mimeType: "image/png",
      filename: "x.png",
    });
  });

  it("rejects absolute paths (wire-boundary defence-in-depth, #1099)", () => {
    assert.equal(parseOneAttachment({ path: "/etc/passwd" }), null);
    assert.equal(parseOneAttachment({ path: "\\\\Windows\\\\System32\\\\config" }), null);
  });

  it("rejects any traversal segment", () => {
    assert.equal(parseOneAttachment({ path: "../../etc/passwd" }), null);
    assert.equal(parseOneAttachment({ path: "data/attachments/../../etc/shadow" }), null);
    assert.equal(parseOneAttachment({ path: "data/attachments\\..\\..\\etc\\hosts" }), null);
  });

  it("rejects empty / non-string payload", () => {
    assert.equal(parseOneAttachment(null), null);
    assert.equal(parseOneAttachment("not-an-object"), null);
    assert.equal(parseOneAttachment({ path: "" }), null);
    assert.equal(parseOneAttachment({}), null);
  });
});

describe("chat-service socket — no auth (cont)", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await stopHarness(harness);
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
