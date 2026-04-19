// Tests for ALLOWED_HOSTS hostname-based origin matching.
// Sets env vars BEFORE dynamically importing the module so the
// module-level sets are populated correctly.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";

// Module references populated in before().
let isAllowedOrigin: (origin: string) => boolean;
let requireSameOrigin: (
  req: Request,
  res: Response,
  next: NextFunction,
) => void;

before(async () => {
  process.env.ALLOWED_ORIGINS = "https://exact.example.com:5173";
  process.env.ALLOWED_HOSTS = "wildcard.example.com,other.test";
  const mod = await import("../../server/api/csrfGuard.js");
  isAllowedOrigin = mod.isAllowedOrigin;
  requireSameOrigin = mod.requireSameOrigin;
});

describe("isAllowedOrigin \u2014 full-origin match via ALLOWED_ORIGINS", () => {
  it("accepts exact origin", () => {
    assert.equal(isAllowedOrigin("https://exact.example.com:5173"), true);
  });

  it("rejects same host different port", () => {
    assert.equal(isAllowedOrigin("https://exact.example.com:3001"), false);
  });

  it("strips trailing slash for comparison", () => {
    assert.equal(isAllowedOrigin("https://exact.example.com:5173/"), true);
  });
});

describe("isAllowedOrigin \u2014 hostname match via ALLOWED_HOSTS", () => {
  it("accepts any port on an allowed host", () => {
    assert.equal(isAllowedOrigin("https://wildcard.example.com:5173"), true);
    assert.equal(isAllowedOrigin("https://wildcard.example.com:3001"), true);
    assert.equal(isAllowedOrigin("https://wildcard.example.com:8080"), true);
    assert.equal(isAllowedOrigin("http://wildcard.example.com"), true);
  });

  it("accepts second allowed host", () => {
    assert.equal(isAllowedOrigin("https://other.test:4000"), true);
  });

  it("rejects unlisted hostnames", () => {
    assert.equal(isAllowedOrigin("https://evil.example.com:5173"), false);
    assert.equal(isAllowedOrigin("https://notother.test:4000"), false);
  });

  it("rejects subdomain spoofing", () => {
    assert.equal(
      isAllowedOrigin("https://sub.wildcard.example.com:5173"),
      false,
    );
  });

  it("rejects empty and malformed inputs", () => {
    assert.equal(isAllowedOrigin(""), false);
    assert.equal(isAllowedOrigin("not a url"), false);
    assert.equal(isAllowedOrigin("null"), false);
  });
});

// Middleware integration

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
  requireSameOrigin(
    req as unknown as Request,
    res as unknown as Response,
    next,
  );
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

describe("requireSameOrigin \u2014 ALLOWED_HOSTS integration", () => {
  it("allows POST from any port on an ALLOWED_HOSTS hostname", () => {
    const { nextCalled, statusCode } = run(
      makeReq("POST", "https://wildcard.example.com:9999"),
      makeRes(),
    );
    assert.equal(nextCalled, true);
    assert.equal(statusCode, 200);
  });

  it("blocks POST from an unlisted hostname", () => {
    const { nextCalled, statusCode } = run(
      makeReq("POST", "https://evil.example.com:5173"),
      makeRes(),
    );
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });
});
