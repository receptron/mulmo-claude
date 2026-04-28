import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  extractNpxPackage,
  checkNpmPackage,
  validateStdioPackages,
  _resetMcpHealthCacheForTest,
  type NpmProber,
  type NpmProbeResult,
} from "../../server/agent/mcpHealth.js";
import type { McpServerSpec } from "../../src/config/mcpTypes.js";

// ── extractNpxPackage — pure parser ────────────────────────────

describe("extractNpxPackage", () => {
  it("returns the package name from `npx -y <pkg>`", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "spotify-mcp"]), "spotify-mcp");
  });

  it("strips the @version suffix from a versioned arg", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "spotify-mcp@latest"]), "spotify-mcp");
    assert.equal(extractNpxPackage("npx", ["-y", "foo@1.2.3"]), "foo");
  });

  it("preserves the leading @ for scoped packages", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "@scope/pkg"]), "@scope/pkg");
    assert.equal(extractNpxPackage("npx", ["-y", "@scope/pkg@2.0.0"]), "@scope/pkg");
  });

  it("skips short and long flags before the package", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "--verbose", "@modelcontextprotocol/server-github"]), "@modelcontextprotocol/server-github");
  });

  it("works with absolute path npx (workspace-local node_modules)", () => {
    assert.equal(extractNpxPackage("/usr/bin/npx", ["-y", "foo"]), "foo");
    assert.equal(extractNpxPackage("/Users/me/project/node_modules/.bin/npx", ["-y", "bar"]), "bar");
  });

  it("returns null for non-npx commands", () => {
    assert.equal(extractNpxPackage("node", ["-y", "foo"]), null);
    assert.equal(extractNpxPackage("python", ["-m", "foo"]), null);
  });

  it("returns null when args contain only flags", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "--no-install"]), null);
  });

  it("returns null when args is missing or empty", () => {
    assert.equal(extractNpxPackage("npx", undefined), null);
    assert.equal(extractNpxPackage("npx", []), null);
  });
});

// ── Behaviour tests for checkNpmPackage / validateStdioPackages ──
// We inject an NpmProber so tests don't shell out.

beforeEach(() => {
  _resetMcpHealthCacheForTest();
});

function countingProber(table: Record<string, NpmProbeResult>): { prober: NpmProber; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const prober: NpmProber = async (pkg) => {
    calls.set(pkg, (calls.get(pkg) ?? 0) + 1);
    // Simulate async work so concurrent callers can race the cache.
    await new Promise((resolve) => setImmediate(resolve));
    return table[pkg] ?? "exists";
  };
  return { prober, calls };
}

describe("checkNpmPackage — caching contract", () => {
  it('caches "exists" results for the process lifetime', async () => {
    const { prober, calls } = countingProber({ "fake-pkg": "exists" });
    assert.equal(await checkNpmPackage("fake-pkg", prober), "exists");
    assert.equal(await checkNpmPackage("fake-pkg", prober), "exists");
    assert.equal(calls.get("fake-pkg"), 1, "second call must hit the cache, not the prober");
  });

  it('caches "missing" results so duplicate warnings are suppressed', async () => {
    const { prober, calls } = countingProber({ "fake-pkg": "missing" });
    assert.equal(await checkNpmPackage("fake-pkg", prober), "missing");
    assert.equal(await checkNpmPackage("fake-pkg", prober), "missing");
    assert.equal(calls.get("fake-pkg"), 1);
  });

  it("de-duplicates concurrent in-flight lookups for the same package", async () => {
    // Codex iter-1 finding: previously the cache only stored final
    // results, so two concurrent agent spawns would fire two npm
    // view processes for the same package. Now in-flight Promises
    // are also cached, so a second caller awaits the first probe.
    const { prober, calls } = countingProber({ "fake-pkg": "exists" });
    const [first, second, third] = await Promise.all([
      checkNpmPackage("fake-pkg", prober),
      checkNpmPackage("fake-pkg", prober),
      checkNpmPackage("fake-pkg", prober),
    ]);
    assert.equal(first, "exists");
    assert.equal(second, "exists");
    assert.equal(third, "exists");
    assert.equal(calls.get("fake-pkg"), 1, "all three concurrent callers must share one prober invocation");
  });

  it("does not bleed cache between different packages", async () => {
    const { prober } = countingProber({ "alpha-pkg": "exists", "beta-pkg": "missing" });
    assert.equal(await checkNpmPackage("alpha-pkg", prober), "exists");
    assert.equal(await checkNpmPackage("beta-pkg", prober), "missing");
  });
});

describe("validateStdioPackages — walks user servers", () => {
  function makeWarnSink(): { warns: { message: string; data?: Record<string, unknown> }[]; restore: () => void } {
    // mcpHealth uses log.warn from server/system/logger; intercepting
    // via console is fragile because the real logger formats first.
    // We instead assert on prober calls — the prober is the side that
    // determines whether a warn fires. The warn itself is one more
    // log.warn call we trust the existing logging tests cover.
    return { warns: [], restore: () => {} };
  }

  it("probes every enabled stdio server with an npx command", async () => {
    const { prober, calls } = countingProber({
      "@modelcontextprotocol/server-github": "exists",
      "spotify-mcp": "missing",
    });
    const userServers: Record<string, McpServerSpec> = {
      github: {
        type: "stdio",
        enabled: true,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      },
      spotify: {
        type: "stdio",
        enabled: true,
        command: "npx",
        args: ["-y", "spotify-mcp@latest"],
      },
    };
    makeWarnSink();
    await validateStdioPackages(userServers, prober);
    assert.equal(calls.get("@modelcontextprotocol/server-github"), 1);
    assert.equal(calls.get("spotify-mcp"), 1);
  });

  it("skips disabled stdio servers", async () => {
    const { prober, calls } = countingProber({});
    const userServers: Record<string, McpServerSpec> = {
      disabled: {
        type: "stdio",
        enabled: false,
        command: "npx",
        args: ["-y", "should-not-probe"],
      },
    };
    await validateStdioPackages(userServers, prober);
    assert.equal(calls.get("should-not-probe"), undefined, "disabled server must not be probed");
  });

  it("skips stdio servers whose command isn't an npx invocation", async () => {
    const { prober, calls } = countingProber({});
    const userServers: Record<string, McpServerSpec> = {
      pythonServer: {
        type: "stdio",
        enabled: true,
        command: "python",
        args: ["-m", "some.module"],
      },
    };
    await validateStdioPackages(userServers, prober);
    assert.equal(calls.size, 0, "non-npx commands must not invoke the prober");
  });

  it("skips http servers entirely (no package to probe)", async () => {
    const { prober, calls } = countingProber({});
    const userServers: Record<string, McpServerSpec> = {
      httpServer: {
        type: "http",
        enabled: true,
        url: "https://example.com/mcp",
      },
    };
    await validateStdioPackages(userServers, prober);
    assert.equal(calls.size, 0);
  });

  it("returns cleanly when there are no user servers", async () => {
    const { prober } = countingProber({});
    await assert.doesNotReject(validateStdioPackages({}, prober));
  });

  it("strips the @version suffix before probing (so the cache key matches the registry name)", async () => {
    // Regression for the `spotify-mcp@latest` catalog entry — the
    // cache must key off the bare package name, otherwise every new
    // version pin would evade the cache and re-probe.
    const { prober, calls } = countingProber({ "spotify-mcp": "exists" });
    const userServers: Record<string, McpServerSpec> = {
      spotify: {
        type: "stdio",
        enabled: true,
        command: "npx",
        args: ["-y", "spotify-mcp@latest"],
      },
    };
    await validateStdioPackages(userServers, prober);
    assert.equal(calls.get("spotify-mcp"), 1);
    assert.equal(calls.get("spotify-mcp@latest"), undefined);
  });
});

describe("checkNpmPackage — transient-failure resilience", () => {
  it("returns 'exists' when the prober throws (ambiguous failure)", async () => {
    // defaultNpmProbe rejects on timeout / spawn error / ambiguous
    // exit. checkNpmPackage catches and returns "exists" so we don't
    // emit a false "package missing" warn during a network blip.
    const rejecter: NpmProber = (__pkg) => Promise.reject(new Error("npm view timed out"));
    assert.equal(await checkNpmPackage("flaky-pkg", rejecter), "exists");
  });

  it("does NOT cache an ambiguous-failure outcome — a later healthy probe wins", async () => {
    // Codex iter-1 finding: previously the timeout path wrote
    // "missing" into the cache after `proc.kill()` fired exit, which
    // poisoned the cache for the rest of the process lifetime. The
    // throw-based contract avoids that: a rejection produces an
    // uncached "exists", so the next probe writes the real verdict.
    let throwOnce = true;
    const flaky: NpmProber = async (__pkg) => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("transient");
      }
      return "missing";
    };
    assert.equal(await checkNpmPackage("flaky-pkg", flaky), "exists");
    // Cache should be empty — second call re-probes and gets the
    // real verdict.
    assert.equal(await checkNpmPackage("flaky-pkg", flaky), "missing");
  });

  it("memoizes a confident 'exists' across calls (cache write happens after success)", async () => {
    // Companion to the test above — confirms the cache IS written
    // on a confident outcome, so we don't accidentally re-probe
    // every spawn after the npm view succeeds.
    const { prober, calls } = countingProber({ "stable-pkg": "exists" });
    assert.equal(await checkNpmPackage("stable-pkg", prober), "exists");
    assert.equal(await checkNpmPackage("stable-pkg", prober), "exists");
    assert.equal(calls.get("stable-pkg"), 1);
  });
});
