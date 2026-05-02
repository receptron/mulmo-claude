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

describe("readTokenFromLauncherLog", () => {
  // The launcher tees stdout/stderr into the smoke's logFile. The
  // server logs `INFO  [auth] bearer token written path=<absolute>
  // source=...` exactly once per boot. Grep that line, then read the
  // file at the captured path. Tests inject a fake reader so they
  // don't touch the disk.
  function fakeReader(map: Record<string, string | Error>): (filePath: string, encoding: "utf8") => Promise<string> {
    return async (filePath) => {
      const value = map[filePath];
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error(`fake reader: unmapped path ${filePath}`);
      return value;
    };
  }

  it("extracts the path and returns the trimmed token", async () => {
    const logFile = "/tmp/log";
    const tokenFile = "/tmp/ws/.session-token";
    const readFileImpl = fakeReader({
      [logFile]: `[out] 2026-05-02T...Z INFO  [auth] bearer token written path=${tokenFile} source=random\n[out] more...\n`,
      [tokenFile]: "abc123\n",
    });
    const token = await tarball.readTokenFromLauncherLog({ logFile, readFileImpl });
    assert.equal(token, "abc123");
  });

  it("returns null when the marker line is absent", async () => {
    const readFileImpl = fakeReader({ "/tmp/log": "no token line in here\n" });
    assert.equal(await tarball.readTokenFromLauncherLog({ logFile: "/tmp/log", readFileImpl }), null);
  });

  it("returns null when the log file itself is unreadable", async () => {
    const readFileImpl = fakeReader({ "/tmp/log": new Error("ENOENT") });
    assert.equal(await tarball.readTokenFromLauncherLog({ logFile: "/tmp/log", readFileImpl }), null);
  });

  it("returns null when the captured token path can't be read", async () => {
    const readFileImpl = fakeReader({
      "/tmp/log": "INFO bearer token written path=/tmp/ghost source=random\n",
      "/tmp/ghost": new Error("ENOENT"),
    });
    assert.equal(await tarball.readTokenFromLauncherLog({ logFile: "/tmp/log", readFileImpl }), null);
  });
});

describe("probeRuntimePlugins", () => {
  function fakeFetch(handler: (url: string, init?: { headers?: Record<string, string> }) => Response | Promise<Response>): typeof globalThis.fetch {
    return ((url: string, init?: { headers?: Record<string, string> }) => Promise.resolve(handler(url, init))) as unknown as typeof globalThis.fetch;
  }

  it("ok=true and plugins=N on a 200 with a non-empty list", async () => {
    let seenAuth: string | undefined;
    const fetchImpl = fakeFetch((_url, init) => {
      seenAuth = init?.headers?.Authorization;
      return new Response(JSON.stringify({ plugins: [{ name: "@example/installed" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.plugins, 1);
    assert.equal(seenAuth, "Bearer tok", "Authorization header must be sent");
  });

  // Fresh install with no presets and no user-installed plugins is a
  // legitimate state — the route still responds correctly. The probe
  // verifies wiring (auth, route mount, JSON shape), not population.
  it("ok=true on a 200 with an empty plugins array (fresh install, no plugins yet)", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ plugins: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.plugins, 0);
    assert.equal(result.lastError, null);
  });

  it("ok=false on a 200 whose body is not the expected `{ plugins: [...] }` shape", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ unrelated: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /not \{ plugins/);
  });

  it("ok=false with a status code on a non-200 response", async () => {
    const fetchImpl = fakeFetch(() => new Response("Unauthorized", { status: 401 }));
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it("ok=false when token is missing (extraction failed upstream)", async () => {
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: null });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /no bearer token/);
  });

  it("ok=false when fetch throws (server still booting / wrong port)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /ECONNREFUSED/);
  });
});
