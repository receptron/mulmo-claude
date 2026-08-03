// Protocol 2.0.0 removed the single generic on `dispatch`: naming the result
// type at a call site never checked anything, because the caller had not seen
// the bytes. The reader it replaced it with is the ONLY thing that checks.
//
// The host must therefore RUN it. Accepting `parse` in the signature and
// ignoring it at runtime is worse than not migrating — every call site would
// read as validated while nothing ran, which is what these tests pin.
// (Codex review on #2783 caught exactly that.)
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeDispatch } from "../../src/utils/plugin/runtime.ts";

const realFetch = globalThis.fetch;

/** Answer every request with `body`, as the plugin dispatch route would. */
function stubFetch(body: unknown, ok = true): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      headers: new Headers({ "content-type": "application/json" }),
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    } as unknown as Response)) as typeof globalThis.fetch;
}

beforeEach(() => stubFetch({ ok: true }));
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("makeDispatch (#2783 protocol 2.0.0 arities)", () => {
  it("returns the raw response when no reader is given", async () => {
    stubFetch({ ok: true, bookmarks: [{ id: "a" }] });
    const dispatch = makeDispatch("@scope/pkg");
    assert.deepEqual(await dispatch({ kind: "list" }), { ok: true, bookmarks: [{ id: "a" }] });
  });

  it("RUNS the reader and resolves to what it returned", async () => {
    stubFetch({ ok: true, count: 2 });
    const dispatch = makeDispatch("@scope/pkg");
    const seen: unknown[] = [];
    const value = await dispatch({ kind: "list" }, (raw) => {
      seen.push(raw);
      return "read";
    });
    assert.equal(value, "read", "the reader's return value is the result");
    assert.deepEqual(seen, [{ ok: true, count: 2 }], "the reader saw the response body");
  });

  // The regression this file exists for: a host that ignored `parse` still
  // type-checked, because a one-arg function is assignable to the overload.
  it("does not silently skip a reader that rejects the payload", async () => {
    stubFetch({ unexpected: true });
    const dispatch = makeDispatch("@scope/pkg");
    await assert.rejects(
      () =>
        dispatch({ kind: "list" }, () => {
          throw new Error("bad payload");
        }),
      /bad payload/,
      "a throwing reader must reach the caller — its try/catch is where a bad response belongs",
    );
  });

  it("throws on a non-2xx response before any reader runs", async () => {
    stubFetch({ message: "boom" }, false);
    const dispatch = makeDispatch("@scope/pkg");
    let readerRan = false;
    await assert.rejects(() =>
      dispatch({ kind: "list" }, () => {
        readerRan = true;
        return null;
      }),
    );
    assert.equal(readerRan, false, "an error response is not a payload to parse");
  });
});
