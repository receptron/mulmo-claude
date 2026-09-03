import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { probeShimReady, shimProbeUrl, shimSseUrl } from "../../server/agent/stdioHttpShim.js";

// A stand-in for supergateway's stdio→SSE gateway, reproducing the one
// behaviour that broke #3018: it holds a SINGLE MCP `Server`, so the
// second GET of the stream path throws "Already connected to a
// transport" inside the request handler and takes the process down.
// Closing the first stream does not release it — the real gateway never
// calls `server.close()`. A readiness probe that opens the stream
// therefore burns the only session the agent will ever get.
function startFakeGateway(): Promise<{ server: Server; port: number; state: () => { sseConnects: number; fatal: boolean } }> {
  let sseConnects = 0;
  let fatal = false;
  const server = createServer((req, res) => {
    const [path] = (req.url ?? "").split("?");
    if (path === "/sse") {
      sseConnects += 1;
      if (sseConnects > 1) {
        // The real gateway dies here; record it rather than exiting.
        fatal = true;
        res.writeHead(500).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: endpoint\ndata: /message\n\n");
      return;
    }
    if (path === "/message" && req.method === "POST") {
      res.writeHead(400).end("Missing sessionId parameter");
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port, state: () => ({ sseConnects, fatal }) });
    });
  });
}

describe("shim readiness probe (#3018)", () => {
  it("reports ready without consuming the gateway's only SSE session", async () => {
    const { server, port, state } = await startFakeGateway();
    try {
      assert.equal(await probeShimReady(port), true, "a 400 on the message path proves the gateway is listening");
      assert.equal(state().sseConnects, 0, "the probe must never open the SSE stream");

      // The agent now connects — this is the session the probe must
      // have left alone. Before the fix the probe took it and this
      // connect was the fatal second one.
      const res = await fetch(shimSseUrl(port), { signal: AbortSignal.timeout(2000) });
      assert.equal(res.status, 200, "the agent gets a working stream");
      await res.body?.cancel();
      assert.equal(state().fatal, false, "the gateway must still be alive for the agent");
    } finally {
      // Force-close: a held-open SSE response keeps `close()` waiting
      // forever, which would turn an assertion failure into a CI hang
      // instead of a red test.
      server.closeAllConnections();
      server.close();
    }
  });

  it("reports not-ready when nothing is listening", async () => {
    // Port 1 is reserved and never served; a failed probe must be false
    // (caller drops the server) rather than throwing.
    assert.equal(await probeShimReady(1), false);
  });

  it("probes a different path than the one it advertises", () => {
    assert.notEqual(new URL(shimProbeUrl(39100)).pathname, new URL(shimSseUrl(39100)).pathname);
  });
});
