import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FETCH_TIMEOUT_MS, extractFetchError, fetchWithTimeout } from "../../server/utils/fetch.js";

function mockResponse(status: number, body: unknown, jsonThrows = false): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (jsonThrows) throw new Error("not json");
      return body;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("extractFetchError", () => {
  it("extracts the error field from a JSON { error } body", async () => {
    const msg = await extractFetchError(mockResponse(400, { error: "bad request" }));
    assert.equal(msg, "bad request");
  });

  it("falls back to HTTP status when body has no error field", async () => {
    const msg = await extractFetchError(mockResponse(500, { other: "field" }));
    assert.equal(msg, "HTTP 500");
  });

  it("falls back to HTTP status when json() throws", async () => {
    const msg = await extractFetchError(mockResponse(502, null, true));
    assert.equal(msg, "HTTP 502");
  });

  it("falls back to HTTP status for empty body", async () => {
    const msg = await extractFetchError(mockResponse(404, {}));
    assert.equal(msg, "HTTP 404");
  });
});

describe("fetchWithTimeout", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("exposes a sensible default timeout", () => {
    assert.equal(DEFAULT_FETCH_TIMEOUT_MS, 10_000);
  });

  it("returns the response on happy path", async () => {
    const expected = new Response("ok", { status: 200 });
    globalThis.fetch = async () => expected;
    const res = await fetchWithTimeout("http://example.test/");
    assert.equal(res, expected);
  });

  it("rejects with a TimeoutError when the peer stalls past timeoutMs", async () => {
    // fetch never resolves — the timer must win.
    globalThis.fetch = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject((init.signal as AbortSignal & { reason?: unknown }).reason ?? new Error("aborted"));
        });
      });
    await assert.rejects(
      () => fetchWithTimeout("http://example.test/", { timeoutMs: 25 }),
      (err: unknown) => err instanceof DOMException && err.name === "TimeoutError" && /25ms/.test(err.message),
    );
  });

  it("aborts in-flight when the caller's signal fires", async () => {
    const caller = new AbortController();
    globalThis.fetch = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject((init.signal as AbortSignal & { reason?: unknown }).reason ?? new Error("aborted"));
        });
      });
    const pending = fetchWithTimeout("http://example.test/", { signal: caller.signal, timeoutMs: 5_000 });
    const customReason = new Error("caller cancelled");
    setTimeout(() => caller.abort(customReason), 10);
    await assert.rejects(pending, (err: unknown) => err === customReason);
  });

  it("rejects immediately when the caller's signal is already aborted", async () => {
    const caller = new AbortController();
    const reason = new Error("already cancelled");
    caller.abort(reason);
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("should not reach here");
    };
    // fetch() itself is what rejects here because we pass the
    // already-aborted controller.signal. The helper's job is just to
    // make sure that propagation happens (and doesn't deadlock).
    await assert.rejects(
      () => fetchWithTimeout("http://example.test/", { signal: caller.signal }),
      (err: unknown) => err === reason,
    );
    assert.equal(fetchCalled, false, "fetch should not run when signal is pre-aborted");
  });

  it("does not leave the timer pending after a successful response", async () => {
    // If the finally clause didn't clearTimeout, subsequent tests
    // would see the handle keep the event loop alive. We can't
    // observe that directly, but running 50 quick calls exercises
    // the cleanup path and would surface a leak under --detectOpenHandles.
    globalThis.fetch = async () => new Response("ok");
    for (let i = 0; i < 50; i++) {
      await fetchWithTimeout("http://example.test/", { timeoutMs: 5_000 });
    }
  });
});
