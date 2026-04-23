// Unit tests for the pure helpers in scripts/mulmoclaude/tarball.mjs.
//
// The full end-to-end `runTarballSmoke` flow is deliberately NOT
// exercised here — it takes 30-60s and requires a built repo. The
// CI workflow that wraps it (plan step 5) IS the integration test.
// Anything testable WITHOUT spawning npm or binding a real port is
// covered below.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import * as tarball from "../../../scripts/mulmoclaude/tarball.mjs";

describe("allocateRandomPort", () => {
  it("returns a positive non-standard TCP port", async () => {
    const port = await tarball.allocateRandomPort();
    assert.ok(Number.isInteger(port), `expected integer port, got ${port}`);
    assert.ok(port > 1024 && port < 65_536, `port ${port} out of ephemeral range`);
  });

  it("can actually be bound after allocation (no leftover server)", async () => {
    // Regression guard: if allocateRandomPort forgot to close() the
    // probe server, we'd get EADDRINUSE binding the same port here.
    const port = await tarball.allocateRandomPort();
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
    });
  });

  it("returns distinct ports across parallel calls", async () => {
    const ports = await Promise.all([tarball.allocateRandomPort(), tarball.allocateRandomPort(), tarball.allocateRandomPort()]);
    assert.equal(new Set(ports).size, ports.length, `ports collided: ${ports.join(",")}`);
  });
});

describe("pollHttp", () => {
  // Build a clock + sleep pair that a test can drive deterministically.
  function fakeClock() {
    let now = 0;
    return {
      now: () => now,
      sleep: async (delayMs: number) => {
        now += delayMs;
      },
    };
  }

  it("resolves ok on the first 200", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = (async () => new Response("", { status: 200 })) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 1000,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 1);
  });

  it("keeps polling past non-2xx responses then succeeds", async () => {
    const { now, sleep } = fakeClock();
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      const status = call < 3 ? 503 : 200;
      return new Response("", { status });
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 10_000,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 3);
  });

  it("treats fetch rejections like non-2xx and keeps going", async () => {
    const { now, sleep } = fakeClock();
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call < 2) throw new Error("ECONNREFUSED");
      return new Response("", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 10_000,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
  });

  it("times out with the last error when the server never responds", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 500,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, false);
    assert.equal(result.lastError, "ECONNREFUSED");
    assert.ok(result.attempts >= 1);
  });

  it("reports non-2xx HTTP status codes as last error on timeout", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = (async () => new Response("", { status: 500 })) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 500,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, false);
    assert.equal(result.lastError, "status 500");
  });

  it("accepts any 2xx, not just 200", async () => {
    const { now, sleep } = fakeClock();
    // Response constructor rejects a body on 204 — pass null so the
    // test actually hits the 2xx acceptance branch rather than
    // blowing up in the mock itself.
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 1000,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, true);
  });
});

describe("buildInstallerPackageJson", () => {
  it("produces a private, minimal manifest that references the tarball", () => {
    const pkg = tarball.buildInstallerPackageJson({ tarballName: "mulmoclaude-0.4.0.tgz" });
    assert.equal(pkg.name, "mulmoclaude-smoke-installer");
    assert.equal(pkg.private, true);
    assert.deepEqual(pkg.dependencies, { mulmoclaude: "file:mulmoclaude-0.4.0.tgz" });
  });

  it("omits the dependency entry when no tarball name is given", () => {
    const pkg = tarball.buildInstallerPackageJson();
    assert.deepEqual(pkg.dependencies, {});
  });
});
