// The origin baked into the CSP for HTML artifact previews. Getting it wrong
// does not throw — it emits a syntactically valid but wrong origin, and the
// browser silently refuses the preview's images, styles and media. The
// multi-hop case (#1056) shipped as exactly that kind of quiet breakage.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { browserVisibleOrigin, firstForwardedValue, type OriginSource } from "../../server/utils/forwardedOrigin.js";

const source = (headers: Record<string, string>, protocol = "http"): OriginSource => ({
  get: (name: string) => headers[name.toLowerCase()],
  protocol,
});

describe("firstForwardedValue", () => {
  it("returns a single value unchanged", () => {
    assert.equal(firstForwardedValue("example.com"), "example.com");
  });

  // Each proxy hop appends its own value; only the outermost one is what the
  // browser actually used.
  it("takes only the first hop of a proxy chain", () => {
    assert.equal(firstForwardedValue("a.example.com, b.internal, c.internal"), "a.example.com");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(firstForwardedValue("  example.com  , b.internal"), "example.com");
  });

  it("returns undefined for a missing header", () => {
    assert.equal(firstForwardedValue(undefined), undefined);
  });

  // A header present but empty must fall back to the raw socket values rather
  // than produce `://host` or `proto://`.
  it("returns undefined for empty and whitespace-only values", () => {
    assert.equal(firstForwardedValue(""), undefined);
    assert.equal(firstForwardedValue("   "), undefined);
    assert.equal(firstForwardedValue(","), undefined);
    assert.equal(firstForwardedValue(" , b.internal"), undefined);
  });
});

describe("browserVisibleOrigin", () => {
  // Production without a proxy: the forwarded headers are absent and the raw
  // values are already correct.
  it("falls back to Host and req.protocol when nothing is forwarded", () => {
    assert.equal(browserVisibleOrigin(source({ host: "localhost:3001" })), "http://localhost:3001");
  });

  // Dev: Vite proxies to :3001 with changeOrigin, so Host is the upstream
  // socket and only the forwarded header knows the browser typed :5173.
  it("prefers the forwarded host and protocol", () => {
    const req = source({ host: "localhost:3001", "x-forwarded-host": "localhost:5173", "x-forwarded-proto": "https" }, "http");
    assert.equal(browserVisibleOrigin(req), "https://localhost:5173");
  });

  it("takes each forwarded value independently", () => {
    assert.equal(browserVisibleOrigin(source({ host: "localhost:3001", "x-forwarded-proto": "https" })), "https://localhost:3001");
    assert.equal(browserVisibleOrigin(source({ host: "localhost:3001", "x-forwarded-host": "app.example.com" })), "http://app.example.com");
  });

  // The regression #1056 was reported for: a chain leaked into the origin as
  // `https://a.example.com, b.internal://x`.
  it("uses only the outermost hop of a multi-hop chain", () => {
    const req = source({ host: "10.0.0.7:3001", "x-forwarded-host": "app.example.com, gateway.internal", "x-forwarded-proto": "https, http" }, "http");
    assert.equal(browserVisibleOrigin(req), "https://app.example.com");
  });

  it("ignores empty forwarded headers and falls back", () => {
    const req = source({ host: "localhost:3001", "x-forwarded-host": "", "x-forwarded-proto": "  " }, "http");
    assert.equal(browserVisibleOrigin(req), "http://localhost:3001");
  });

  it("reads the forwarded headers case-insensitively, as Express does", () => {
    const headers: Record<string, string> = { host: "localhost:3001", "x-forwarded-host": "app.example.com" };
    const req: OriginSource = { get: (name) => headers[name.toLowerCase()], protocol: "http" };
    assert.equal(browserVisibleOrigin(req), "http://app.example.com");
  });
});
