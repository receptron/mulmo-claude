import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { asJsonRecord, fetchJsonRecord } from "../src/index.ts";

describe("asJsonRecord", () => {
  it("passes a plain object through", () => {
    assert.deepEqual(asJsonRecord({ a: 1 }), { a: 1 });
  });

  it("defaults non-records (array, null, primitive, undefined) to {}", () => {
    assert.deepEqual(asJsonRecord([1, 2]), {});
    assert.deepEqual(asJsonRecord(null), {});
    assert.deepEqual(asJsonRecord("s"), {});
    assert.deepEqual(asJsonRecord(42), {});
    assert.deepEqual(asJsonRecord(undefined), {});
  });
});

describe("fetchJsonRecord", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const stubFetch = (impl: (url: string, init: RequestInit) => Response) => {
    globalThis.fetch = ((url: string, init: RequestInit) => Promise.resolve(impl(url, init))) as typeof fetch;
  };

  it("returns the narrowed record on a 2xx response", async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true, total: 3 }), { status: 200 }));
    assert.deepEqual(await fetchJsonRecord("https://x/api", {}, "GET /api"), { ok: true, total: 3 });
  });

  it("narrows a non-object 2xx body to {}", async () => {
    stubFetch(() => new Response(JSON.stringify([1, 2, 3]), { status: 200 }));
    assert.deepEqual(await fetchJsonRecord("https://x/api", {}, "GET /api"), {});
  });

  it("throws a labelled error with status and truncated body on non-2xx", async () => {
    const long = "e".repeat(500);
    stubFetch(() => new Response(long, { status: 503 }));
    await assert.rejects(fetchJsonRecord("https://x/api", {}, "POST /chat"), (err: Error) => {
      assert.match(err.message, /^POST \/chat: 503 e+$/);
      assert.equal(err.message.length, "POST /chat: 503 ".length + 200);
      return true;
    });
  });

  it("propagates a network error from fetch unchanged", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("boom"))) as typeof fetch;
    await assert.rejects(fetchJsonRecord("https://x/api", {}, "GET /api"), /boom/);
  });
});
