// Unit tests for the CSRF origin guard middleware. The middleware
// sits in front of every route and rejects state-changing requests
// that carry a non-localhost Origin header — our defense against
// cross-origin CSRF attacks that survive the CORS lockdown in
// #148.
//
// Full design: plans/done/fix-server-csrf-origin-check.md

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import {
  isLocalhostOrigin,
  requireSameOrigin,
} from "../../server/csrfGuard.js";

// --- isLocalhostOrigin: the pure check --------------------------

describe("isLocalhostOrigin — accepts local variants", () => {
  it("accepts plain http://localhost", () => {
    assert.equal(isLocalhostOrigin("http://localhost"), true);
  });

  it("accepts http://localhost with a port", () => {
    assert.equal(isLocalhostOrigin("http://localhost:5173"), true);
    assert.equal(isLocalhostOrigin("http://localhost:3001"), true);
    assert.equal(isLocalhostOrigin("http://localhost:4173"), true);
  });

  it("accepts https://localhost (scheme-agnostic)", () => {
    assert.equal(isLocalhostOrigin("https://localhost"), true);
  });

  it("accepts http://127.0.0.1 with and without port", () => {
    assert.equal(isLocalhostOrigin("http://127.0.0.1"), true);
    assert.equal(isLocalhostOrigin("http://127.0.0.1:8080"), true);
  });

  it("accepts IPv6 loopback http://[::1]", () => {
    assert.equal(isLocalhostOrigin("http://[::1]"), true);
    assert.equal(isLocalhostOrigin("http://[::1]:5173"), true);
  });
});

describe("isLocalhostOrigin — rejects everything else", () => {
  it("rejects a foreign hostname", () => {
    assert.equal(isLocalhostOrigin("http://example.com"), false);
    assert.equal(isLocalhostOrigin("https://attacker.example"), false);
  });

  it("rejects localhost-lookalikes (subdomain attack)", () => {
    // The classic CSRF bypass: register `localhost.evil.com`,
    // hope the check is a substring / suffix match. URL.hostname
    // returns the FULL hostname so a Set membership check is
    // immune.
    assert.equal(isLocalhostOrigin("http://localhost.evil.com"), false);
    assert.equal(isLocalhostOrigin("http://127.0.0.1.nip.io"), false);
  });

  it("rejects evil-prefixed hostnames that lack the dot", () => {
    // `evillocalhost` would match a naive `includes("localhost")`
    // check. Set membership rejects it.
    assert.equal(isLocalhostOrigin("http://evillocalhost"), false);
    assert.equal(isLocalhostOrigin("http://notlocalhost"), false);
  });

  it("rejects a URL that only contains `localhost` in the path", () => {
    assert.equal(
      isLocalhostOrigin("http://attacker.com/path?host=localhost"),
      false,
    );
  });

  it("rejects the string `null`", () => {
    // Browsers set `Origin: null` for sandboxed iframes, file://,
    // data: URLs, and some cross-origin redirects. None of those
    // should be trusted to hit the API.
    assert.equal(isLocalhostOrigin("null"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isLocalhostOrigin(""), false);
  });

  it("rejects non-URL garbage", () => {
    assert.equal(isLocalhostOrigin("not a url"), false);
    assert.equal(isLocalhostOrigin("http://"), false);
  });

  it("rejects a javascript: URI", () => {
    // `new URL("javascript:alert(1)").hostname` is "" — not in
    // the loopback set, so rejected.
    assert.equal(isLocalhostOrigin("javascript:alert(1)"), false);
  });

  it("rejects file:// origins", () => {
    // file:// URLs usually get `Origin: null` in practice, but
    // just in case one arrives as a literal file:// value:
    assert.equal(isLocalhostOrigin("file:///tmp/evil.html"), false);
  });

  it("rejects non-loopback IPs including private LAN addresses", () => {
    // If the server ever re-binds to 0.0.0.0 (don't), a LAN
    // attacker with its own HTTP server could use its own
    // address as Origin. Explicitly rejected.
    assert.equal(isLocalhostOrigin("http://192.168.1.10"), false);
    assert.equal(isLocalhostOrigin("http://10.0.0.1"), false);
    assert.equal(isLocalhostOrigin("http://172.16.0.5"), false);
    assert.equal(isLocalhostOrigin("http://0.0.0.0"), false);
  });
});

// --- requireSameOrigin: Express middleware behaviour ------------

// Minimal fake Request/Response/NextFunction for middleware
// testing — avoids pulling in supertest.
interface FakeReq {
  method: string;
  headers: Record<string, string | undefined>;
}

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
}

function makeReq(method: string, origin?: string): FakeReq {
  return {
    method,
    headers: origin === undefined ? {} : { origin },
  };
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function run(
  req: FakeReq,
  res: FakeRes,
): { nextCalled: boolean; statusCode: number; body: unknown } {
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  // The types differ slightly from real Express — cast through
  // `unknown` since the middleware only touches `method`,
  // `headers`, `status`, `json`.
  requireSameOrigin(
    req as unknown as Request,
    res as unknown as Response,
    next,
  );
  return {
    nextCalled,
    statusCode: res.statusCode,
    body: res.body,
  };
}

describe("requireSameOrigin — safe methods pass through", () => {
  it("lets GET through regardless of Origin", () => {
    for (const origin of [
      undefined,
      "http://localhost",
      "http://example.com",
      "null",
    ]) {
      const { nextCalled, statusCode } = run(makeReq("GET", origin), makeRes());
      assert.equal(nextCalled, true, `expected next() for Origin=${origin}`);
      assert.equal(statusCode, 200);
    }
  });

  it("lets HEAD through regardless of Origin", () => {
    const { nextCalled } = run(
      makeReq("HEAD", "http://example.com"),
      makeRes(),
    );
    assert.equal(nextCalled, true);
  });

  it("lets OPTIONS through (CORS preflight shouldn't be CSRF-checked)", () => {
    const { nextCalled } = run(
      makeReq("OPTIONS", "http://example.com"),
      makeRes(),
    );
    assert.equal(nextCalled, true);
  });
});

describe("requireSameOrigin — state-changing methods, missing Origin", () => {
  // Non-browser callers (curl, MCP tools, Node HTTP libraries)
  // don't set Origin. They're trusted because #148 binds to
  // localhost.

  it("allows POST with no Origin header", () => {
    const { nextCalled, statusCode } = run(makeReq("POST"), makeRes());
    assert.equal(nextCalled, true);
    assert.equal(statusCode, 200);
  });

  it("allows PUT / PATCH / DELETE with no Origin header", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const { nextCalled } = run(makeReq(method), makeRes());
      assert.equal(nextCalled, true, `expected next() for ${method}`);
    }
  });
});

describe("requireSameOrigin — state-changing methods, localhost Origin", () => {
  it("allows POST from http://localhost:5173 (Vite dev)", () => {
    const { nextCalled } = run(
      makeReq("POST", "http://localhost:5173"),
      makeRes(),
    );
    assert.equal(nextCalled, true);
  });

  it("allows POST from http://localhost:3001 (production Express)", () => {
    const { nextCalled } = run(
      makeReq("POST", "http://localhost:3001"),
      makeRes(),
    );
    assert.equal(nextCalled, true);
  });

  it("allows POST from http://127.0.0.1 variants", () => {
    const { nextCalled } = run(
      makeReq("POST", "http://127.0.0.1:5173"),
      makeRes(),
    );
    assert.equal(nextCalled, true);
  });

  it("allows POST from http://[::1] (IPv6 loopback)", () => {
    const { nextCalled } = run(makeReq("POST", "http://[::1]:5173"), makeRes());
    assert.equal(nextCalled, true);
  });
});

describe("requireSameOrigin — state-changing methods, foreign Origin (blocked)", () => {
  function assertBlocked(method: string, origin: string) {
    const { nextCalled, statusCode, body } = run(
      makeReq(method, origin),
      makeRes(),
    );
    assert.equal(
      nextCalled,
      false,
      `${method} from ${origin} should be blocked`,
    );
    assert.equal(statusCode, 403);
    assert.ok(
      body && typeof body === "object" && "error" in body,
      "response body should include an error field",
    );
  }

  it("blocks POST from an arbitrary foreign origin", () => {
    assertBlocked("POST", "http://evil.example");
  });

  it("blocks POST from a localhost subdomain lookalike", () => {
    // The classic CSRF bypass: register `localhost.evil.com`,
    // hope the hostname check is a substring match.
    assertBlocked("POST", "http://localhost.evil.com");
  });

  it("blocks POST from `http://evillocalhost` (no-dot lookalike)", () => {
    assertBlocked("POST", "http://evillocalhost");
  });

  it("blocks POST with Origin `null` (sandboxed iframe / file:// / data:)", () => {
    assertBlocked("POST", "null");
  });

  it("blocks POST with a malformed Origin", () => {
    assertBlocked("POST", "not a url");
  });

  it("blocks PUT / PATCH / DELETE with a foreign Origin", () => {
    assertBlocked("PUT", "http://evil.example");
    assertBlocked("PATCH", "http://evil.example");
    assertBlocked("DELETE", "http://evil.example");
  });

  it("blocks POST from a private-LAN IP (defensive for future re-bind)", () => {
    // Even if the server is re-bound to 0.0.0.0 in the future,
    // a LAN attacker can't use its own address as a trusted
    // Origin.
    assertBlocked("POST", "http://192.168.1.10");
    assertBlocked("POST", "http://10.0.0.1");
  });
});
