import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { apiCall, apiGet, apiPost, apiPut, apiDelete, apiFetchRaw, backendReachable, lastBackendError, setAuthToken } from "../../src/utils/api.ts";

// fetch mocking. Capture the URL + init passed by the api module, and
// reply with a pre-scripted response. Each test installs its own mock
// and restores the original fetch in afterEach.

// Match fetch's signature without importing DOM lib types by deriving
// everything from `typeof fetch`.
type FetchFn = typeof fetch;
type FetchInit = Parameters<FetchFn>[1];

interface MockCall {
  url: string;
  init: FetchInit;
}
let calls: MockCall[] = [];
let nextResponse: Response = new Response("", { status: 200 });
const originalFetch = globalThis.fetch;

function installMock(): void {
  calls = [];
  const mock: FetchFn = (url, init) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(nextResponse.clone());
  };
  globalThis.fetch = mock;
}

function restoreMock(): void {
  globalThis.fetch = originalFetch;
}

// Access headers off a captured init without needing a DOM-lib
// `HeadersInit` import. api.ts always passes a plain string map.
function getHeader(call: MockCall, name: string): string | undefined {
  const headers = call.init?.headers;
  if (!headers || typeof headers !== "object") return undefined;
  const record: Record<string, unknown> = { ...headers };
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiCall — happy path", () => {
  beforeEach(installMock);
  afterEach(() => {
    restoreMock();
    setAuthToken(null);
  });

  it("GET returns parsed JSON on 200", async () => {
    nextResponse = jsonResponse(200, { hello: "world" });
    const result = await apiGet<{ hello: string }>("/api/thing");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.hello, "world");
  });

  it("POST serializes body as JSON and sets Content-Type", async () => {
    nextResponse = jsonResponse(200, { ok: true });
    await apiPost("/api/thing", { a: 1, b: "two" });
    const [call] = calls;
    assert.equal(call.init?.method, "POST");
    assert.equal(getHeader(call, "Content-Type"), "application/json");
    assert.equal(call.init?.body, JSON.stringify({ a: 1, b: "two" }));
  });

  it("PUT forwards the method", async () => {
    nextResponse = jsonResponse(200, {});
    await apiPut("/api/thing", { x: 1 });
    assert.equal(calls[0].init?.method, "PUT");
  });

  it("DELETE accepts an optional body", async () => {
    nextResponse = jsonResponse(200, {});
    await apiDelete("/api/thing/1");
    assert.equal(calls[0].init?.method, "DELETE");
    assert.equal(calls[0].init?.body, undefined);
  });
});

describe("apiCall — errors", () => {
  beforeEach(installMock);
  afterEach(() => {
    restoreMock();
    setAuthToken(null);
  });

  it("non-2xx with JSON { error } body surfaces the server message", async () => {
    nextResponse = jsonResponse(400, { error: "bad shape" });
    const result = await apiPost("/api/thing", { bogus: true });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "bad shape");
      assert.equal(result.status, 400);
    }
  });

  it("non-2xx without a JSON body falls back to statusText", async () => {
    nextResponse = new Response("not found", {
      status: 404,
      statusText: "Not Found",
    });
    const result = await apiGet("/api/thing/999");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "Not Found");
      assert.equal(result.status, 404);
    }
  });

  it("network failure returns { ok: false, status: 0 }", async () => {
    const failing: FetchFn = () => Promise.reject(new Error("ECONNREFUSED"));
    globalThis.fetch = failing;
    const result = await apiGet("/api/thing");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "ECONNREFUSED");
      assert.equal(result.status, 0);
    }
  });

  it("200 with invalid JSON surfaces a parse error", async () => {
    nextResponse = new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await apiGet("/api/thing");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Invalid JSON/);
  });
});

describe("apiCall — query and headers", () => {
  beforeEach(installMock);
  afterEach(() => {
    restoreMock();
    setAuthToken(null);
  });

  it("appends a query string from the query object", async () => {
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/search", { q: "hello", limit: 10 });
    assert.match(calls[0].url, /\/api\/search\?/);
    assert.match(calls[0].url, /q=hello/);
    assert.match(calls[0].url, /limit=10/);
  });

  it("drops undefined query values", async () => {
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/search", { q: "x", missing: undefined });
    assert.doesNotMatch(calls[0].url, /missing=/);
  });

  it("percent-encodes query values", async () => {
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/search", { q: "a b&c" });
    assert.match(calls[0].url, /q=a%20b%26c/);
  });

  it("includes the bearer token when set", async () => {
    setAuthToken("secret123");
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/thing");
    assert.equal(getHeader(calls[0], "Authorization"), "Bearer secret123");
  });

  it("omits Authorization when no token set", async () => {
    setAuthToken(null);
    nextResponse = jsonResponse(200, {});
    await apiGet("/api/thing");
    assert.equal(getHeader(calls[0], "Authorization"), undefined);
  });

  it("caller-provided headers survive", async () => {
    nextResponse = jsonResponse(200, {});
    await apiCall("/api/thing", {
      method: "GET",
      headers: { "X-Custom": "1" },
    });
    assert.equal(getHeader(calls[0], "X-Custom"), "1");
  });
});

// #1479 — backend-reachability signal. A `fetch` throw flips
// `backendReachable` false (with the error message stored); any
// subsequent HTTP reply (including 4xx/5xx) flips it back true.
describe("apiCall — backendReachable signal", () => {
  beforeEach(() => {
    backendReachable.value = true;
    lastBackendError.value = null;
  });
  afterEach(restoreMock);

  it("flips to false on a fetch throw (network error / ERR_CONNECTION_REFUSED)", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("connection refused"))) as typeof fetch;
    const result = await apiCall("/api/anything");
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.equal(result.status, 0);
      assert.match(result.error, /connection refused/);
    }
    assert.equal(backendReachable.value, false);
    assert.match(lastBackendError.value ?? "", /connection refused/);
  });

  it("flips back to true on the next successful HTTP reply", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("down"))) as typeof fetch;
    await apiCall("/api/anything");
    assert.equal(backendReachable.value, false);

    installMock();
    nextResponse = jsonResponse(200, { ok: true });
    await apiCall("/api/anything");
    assert.equal(backendReachable.value, true);
    assert.equal(lastBackendError.value, null);
  });

  it("flips back to true even when the HTTP reply is a 4xx/5xx", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("down"))) as typeof fetch;
    await apiCall("/api/anything");
    assert.equal(backendReachable.value, false);

    installMock();
    nextResponse = jsonResponse(500, { error: "boom" });
    await apiCall("/api/anything");
    // Server replied → backend is reachable, even though the request itself failed.
    assert.equal(backendReachable.value, true);
  });

  it("does NOT flip on caller-driven AbortError (normal cancel flow)", async () => {
    // Simulate `AbortController.abort()` mid-flight: fetch rejects
    // with a DOMException-shaped AbortError. This is a normal
    // navigation/race flow — must not surface as backend-offline.
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    globalThis.fetch = (() => Promise.reject(abortErr)) as typeof fetch;
    const result = await apiCall("/api/anything");
    assert.equal(result.ok, false);
    assert.equal(backendReachable.value, true);
    assert.equal(lastBackendError.value, null);
  });
});

describe("stale-token recovery (401 → re-read token from index.html → retry once)", () => {
  // Sequenced mock: each call shifts the next scripted response.
  // Needed here because recovery involves three different exchanges
  // (401 from the API, "/" serving fresh HTML, then the replay).
  let seq: Response[] = [];
  function installSeqMock(): void {
    calls = [];
    globalThis.fetch = ((url, init) => {
      calls.push({ url: String(url), init });
      const next = seq.shift() ?? new Response("", { status: 599 });
      return Promise.resolve(next);
    }) as typeof fetch;
  }
  afterEach(() => {
    restoreMock();
    setAuthToken(null);
  });

  function htmlWithToken(token: string): Response {
    return new Response(`<!doctype html><head><meta name="mulmoclaude-auth" content="${token}" /></head>`, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }

  it("apiCall retries once with the fresh token and succeeds", async () => {
    setAuthToken("stale-token");
    installSeqMock();
    seq = [jsonResponse(401, { error: "unauthorized" }), htmlWithToken("fresh-token"), jsonResponse(200, { fine: true })];

    const result = await apiCall<{ fine: boolean }>("/api/anything");

    assert.equal(result.ok, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].url, "/");
    assert.equal(getHeader(calls[2], "Authorization"), "Bearer fresh-token");
  });

  it("does not retry when the served token is unchanged (genuine 401)", async () => {
    setAuthToken("same-token");
    installSeqMock();
    seq = [jsonResponse(401, { error: "unauthorized" }), htmlWithToken("same-token")];

    const result = await apiCall("/api/anything");

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    assert.equal(calls.length, 2);
  });

  it("surfaces the original 401 when the token refetch itself fails", async () => {
    setAuthToken("stale-token");
    installSeqMock();
    seq = [jsonResponse(401, { error: "unauthorized" }), new Response("", { status: 500 })];

    const result = await apiCall("/api/anything");

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
    assert.equal(calls.length, 2);
  });

  it("apiFetchRaw (chat send path) recovers the same way", async () => {
    setAuthToken("stale-token");
    installSeqMock();
    seq = [jsonResponse(401, { error: "unauthorized" }), htmlWithToken("fresh-token"), jsonResponse(200, { streaming: "ok" })];

    const res = await apiFetchRaw("/api/agent", { method: "POST", body: JSON.stringify({ message: "hi" }) });

    assert.equal(res.status, 200);
    assert.equal(calls.length, 3);
    assert.equal(getHeader(calls[2], "Authorization"), "Bearer fresh-token");
  });
});
