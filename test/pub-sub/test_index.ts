import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { createPubSub, type IPubSub } from "../../server/events/pub-sub/index.js";

// Round-trip test for the socket.io-backed pub/sub transport.
// Boots a real HTTP server on an ephemeral port, attaches the
// pub/sub, connects a real socket.io-client, and asserts that a
// server-side `publish()` is fanned out to subscribed clients and
// NOT delivered to clients that haven't subscribed.

describe("pub-sub (socket.io round trip)", () => {
  let server: http.Server;
  let pubsub: IPubSub;
  let url: string;

  before(async () => {
    server = http.createServer();
    pubsub = createPubSub(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connected(): Promise<Socket> {
    const socket = connect(url, { path: "/ws/pubsub", transports: ["websocket"] });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  }

  it("delivers publish() to a subscribed client", async () => {
    const socket = await connected();
    const received = new Promise<unknown>((resolve) => socket.once("data", (msg) => resolve(msg)));
    socket.emit("subscribe", "alpha");
    // Wait for the subscribe to register as a room join before
    // publishing — socket.io rooms join synchronously on the
    // server once the event handler runs, but the handler runs
    // on the next tick after the emit. One microtask yield is
    // plenty.
    await new Promise((resolve) => setTimeout(resolve, 20));
    pubsub.publish("alpha", { hello: "world" });
    const msg = await received;
    assert.deepEqual(msg, { channel: "alpha", data: { hello: "world" } });
    socket.disconnect();
  });

  it("does not deliver to non-subscribers", async () => {
    const sub = await connected();
    const other = await connected();
    sub.emit("subscribe", "beta");
    await new Promise((resolve) => setTimeout(resolve, 20));

    let otherGotData = false;
    other.on("data", () => {
      otherGotData = true;
    });

    const received = new Promise<unknown>((resolve) => sub.once("data", (msg) => resolve(msg)));
    pubsub.publish("beta", { n: 1 });
    await received;
    // Give the "other" client a tick to receive (and thus fail).
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(otherGotData, false);

    sub.disconnect();
    other.disconnect();
  });

  it("stops delivering after unsubscribe", async () => {
    const socket = await connected();
    socket.emit("subscribe", "gamma");
    await new Promise((resolve) => setTimeout(resolve, 20));

    // First publish — should arrive.
    const first = new Promise<unknown>((resolve) => socket.once("data", (msg) => resolve(msg)));
    pubsub.publish("gamma", { seq: 1 });
    await first;

    // Now unsubscribe.
    socket.emit("unsubscribe", "gamma");
    await new Promise((resolve) => setTimeout(resolve, 20));

    let got = false;
    socket.on("data", () => {
      got = true;
    });
    pubsub.publish("gamma", { seq: 2 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(got, false);
    socket.disconnect();
  });
});
