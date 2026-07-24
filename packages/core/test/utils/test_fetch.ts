// Canonical tests for the one shared `fetchWithTimeout` (#2398). Imports the
// SOURCE (not the built `@mulmoclaude/core/fetch`) so a broken guard here fails
// without a rebuild. The host and the registry/google engines all route through
// this module, so these assertions pin the network-boundary behaviour once.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../../src/utils/fetch.ts";

// A fetch stub that never resolves on its own — it only rejects when its
// `signal` aborts, echoing whatever reason drove the abort. Lets a test prove
// which signal (timer vs caller) won the race.
function stallingFetchUntilAbort(): typeof globalThis.fetch {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason ?? new Error("aborted"));
      });
    });
}

describe("fetchWithTimeout", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("exposes a 10 s default timeout", () => {
    assert.equal(DEFAULT_FETCH_TIMEOUT_MS, 10_000);
  });

  it("returns the response on the happy path", async () => {
    const expected = new Response("ok", { status: 200 });
    globalThis.fetch = async () => expected;
    assert.equal(await fetchWithTimeout("http://example.test/"), expected);
  });

  it("rejects with a TimeoutError once timeoutMs elapses", async () => {
    globalThis.fetch = stallingFetchUntilAbort();
    await assert.rejects(
      () => fetchWithTimeout("http://example.test/", { timeoutMs: 25 }),
      (err: unknown) => err instanceof DOMException && err.name === "TimeoutError" && /25ms/.test(err.message),
    );
  });

  it("rejects immediately, without touching the network, when the caller signal is pre-aborted", async () => {
    const caller = new AbortController();
    const reason = new Error("already cancelled");
    caller.abort(reason);
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("should not reach here");
    };
    await assert.rejects(
      () => fetchWithTimeout("http://example.test/", { signal: caller.signal }),
      (err: unknown) => err === reason,
    );
    assert.equal(fetchCalled, false, "fetch must not run when the caller signal is pre-aborted");
  });

  // #2221 regression: the caller's signal must be COMPOSED with the internal
  // timeout controller, never overwritten. A mid-flight caller abort has to
  // propagate through to the in-flight fetch (before the fix it was dropped).
  it("composes the caller signal so a mid-flight caller abort propagates (#2221)", async () => {
    const caller = new AbortController();
    globalThis.fetch = stallingFetchUntilAbort();
    const pending = fetchWithTimeout("http://example.test/", { signal: caller.signal, timeoutMs: 5_000 });
    const callerReason = new Error("caller cancelled mid-flight");
    setTimeout(() => caller.abort(callerReason), 10);
    await assert.rejects(pending, (err: unknown) => err === callerReason);
  });

  it("clears the timer after a successful response (no leaked handle)", async () => {
    globalThis.fetch = async () => new Response("ok");
    for (let i = 0; i < 50; i++) {
      await assert.doesNotReject(fetchWithTimeout("http://example.test/", { timeoutMs: 5_000 }));
    }
  });
});
