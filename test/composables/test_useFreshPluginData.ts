import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { refreshOnce, type UseFreshPluginDataOptions } from "../../src/composables/useFreshPluginData.js";

// The Vue-lifecycle-wrapping `useFreshPluginData` needs a Vue test
// harness we don't yet have. These tests exercise the pure core
// (`refreshOnce`) that the composable delegates to — the loop body
// is identical, so any correctness / error-handling bug would show
// up here.

// Save / restore the global fetch so these tests don't leak into
// whatever other tests run in the same Node process. Mirrors the
// pattern used in test/utils/dom/test_scrollable.ts for
// globalThis.getComputedStyle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalFetch: any = (globalThis as any).fetch;

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = originalFetch;
});

function stubFetch(impl: (input: unknown, init?: unknown) => Promise<Response>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = impl;
}

// Build a minimal Response-like object that satisfies the parts of
// the `fetch` contract `refreshOnce` actually touches (`ok`, `json`).
function mockResponse(ok: boolean, jsonPayload: unknown, opts?: { throwOnJson?: boolean }): Response {
  return {
    ok,
    json: async () => {
      if (opts?.throwOnJson) throw new Error("bad json");
      return jsonPayload;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("refreshOnce (core of useFreshPluginData)", () => {
  let appliedWith: unknown[] = [];

  beforeEach(() => {
    appliedWith = [];
  });

  it("calls endpoint, extracts, and applies on happy path", async () => {
    stubFetch(async () => mockResponse(true, { data: { items: [1, 2, 3] } }));
    const controller = new AbortController();
    const opts: UseFreshPluginDataOptions<number[]> = {
      endpoint: () => "/api/todos",
      extract: (json) => {
        const val = (json as { data?: { items?: number[] } }).data?.items;
        return Array.isArray(val) ? val : null;
      },
      apply: (data) => {
        appliedWith.push(data);
      },
    };
    const ok = await refreshOnce(opts, controller.signal);
    assert.equal(ok, true);
    assert.deepEqual(appliedWith, [[1, 2, 3]]);
  });

  it("returns false and skips apply on non-OK response", async () => {
    stubFetch(async () => mockResponse(false, {}));
    const controller = new AbortController();
    const ok = await refreshOnce(
      {
        endpoint: () => "/api/todos",
        extract: () => ["anything"],
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, false);
    assert.deepEqual(appliedWith, []);
  });

  it("returns false and skips apply when JSON parse throws", async () => {
    stubFetch(async () => mockResponse(true, {}, { throwOnJson: true }));
    const controller = new AbortController();
    const ok = await refreshOnce(
      {
        endpoint: () => "/api/todos",
        extract: () => ["anything"],
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, false);
    assert.deepEqual(appliedWith, []);
  });

  it("returns false and skips apply when extract returns null", async () => {
    stubFetch(async () => mockResponse(true, { wrongShape: true }));
    const controller = new AbortController();
    const ok = await refreshOnce(
      {
        endpoint: () => "/api/todos",
        extract: () => null,
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, false);
    assert.deepEqual(appliedWith, []);
  });

  it("swallows AbortError and returns false", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const controller = new AbortController();
    const ok = await refreshOnce(
      {
        endpoint: () => "/api/todos",
        extract: () => ["x"],
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, false);
    assert.deepEqual(appliedWith, []);
  });

  it("swallows other fetch errors and returns false", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    const controller = new AbortController();
    const ok = await refreshOnce(
      {
        endpoint: () => "/api/todos",
        extract: () => ["x"],
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, false);
    assert.deepEqual(appliedWith, []);
  });

  it("bails out early when signal is aborted after fetch resolves", async () => {
    // Fetch resolves OK, but by the time we check the signal we've
    // already been cancelled by a newer refresh. Should NOT apply.
    const controller = new AbortController();
    stubFetch(async () => {
      controller.abort(); // simulate a superseding refresh
      return mockResponse(true, { data: { items: [1] } });
    });
    const ok = await refreshOnce(
      {
        endpoint: () => "/api/todos",
        extract: (json) => {
          const val = (json as { data?: { items?: number[] } }).data?.items;
          return Array.isArray(val) ? val : null;
        },
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, false);
    assert.deepEqual(appliedWith, []);
  });

  it("handles the array-wrapper flavor (todo / scheduler shape)", async () => {
    stubFetch(async () => mockResponse(true, { data: { items: [{ id: "a" }, { id: "b" }] } }));
    const controller = new AbortController();
    const ok = await refreshOnce<{ id: string }[]>(
      {
        endpoint: () => "/api/todos",
        extract: (json) => {
          const val = (json as { data?: { items?: { id: string }[] } }).data?.items;
          return Array.isArray(val) ? val : null;
        },
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, true);
    assert.deepEqual(appliedWith, [[{ id: "a" }, { id: "b" }]]);
  });

  it("handles the bare-array flavor (manageRoles shape)", async () => {
    stubFetch(async () => mockResponse(true, [{ id: "role1" }]));
    const controller = new AbortController();
    const ok = await refreshOnce<{ id: string }[]>(
      {
        endpoint: () => "/api/roles",
        extract: (json) => (Array.isArray(json) ? (json as { id: string }[]) : null),
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, true);
    assert.deepEqual(appliedWith, [[{ id: "role1" }]]);
  });

  it("handles the object flavor (wiki shape)", async () => {
    stubFetch(async () =>
      mockResponse(true, {
        data: { action: "index", title: "Wiki Index", pageEntries: [] },
      }),
    );
    interface WikiData {
      action: string;
      title: string;
      pageEntries: unknown[];
    }
    const controller = new AbortController();
    const ok = await refreshOnce<WikiData>(
      {
        endpoint: () => "/api/wiki",
        extract: (json) => (json as { data?: WikiData }).data ?? null,
        apply: (data) => appliedWith.push(data),
      },
      controller.signal,
    );
    assert.equal(ok, true);
    assert.deepEqual(appliedWith, [{ action: "index", title: "Wiki Index", pageEntries: [] }]);
  });

  it("lets apply guard based on caller state (wiki/Preview index guard)", async () => {
    // Simulates the CodeRabbit V1 #6 fix: wiki/Preview only applies
    // the /api/wiki payload when it's currently showing the index
    // view. Use a local state variable to emulate the ref.
    let currentAction = "page"; // preview is showing a page, not index
    const apply = (data: { action: string }): void => {
      if (currentAction !== "index") return; // guard
      appliedWith.push(data);
    };
    stubFetch(async () => mockResponse(true, { data: { action: "index" } }));
    const controller = new AbortController();
    const ok = await refreshOnce(
      {
        endpoint: () => "/api/wiki",
        extract: (json) => (json as { data?: { action: string } }).data ?? null,
        apply,
      },
      controller.signal,
    );
    // The refresh itself succeeded at fetching + extracting.
    // refreshOnce returns true when apply() was called, regardless
    // of what apply did internally. The guard prevents mutation of
    // caller state, which is what matters.
    assert.equal(ok, true);
    assert.deepEqual(appliedWith, []); // guard kept it out

    // Flip the state and retry — now the guard lets it through.
    currentAction = "index";
    const controller2 = new AbortController();
    await refreshOnce(
      {
        endpoint: () => "/api/wiki",
        extract: (json) => (json as { data?: { action: string } }).data ?? null,
        apply,
      },
      controller2.signal,
    );
    assert.deepEqual(appliedWith, [{ action: "index" }]);
  });

  it("calls endpoint() fresh each refresh (allows dynamic URLs)", async () => {
    const seenUrls: string[] = [];
    stubFetch(async (input: unknown) => {
      seenUrls.push(String(input));
      return mockResponse(true, { data: { items: [] } });
    });
    // Caller mutates `slug` between refreshes — the endpoint thunk
    // should see the new value each time.
    let slug = "alpha";
    const opts: UseFreshPluginDataOptions<unknown[]> = {
      endpoint: () => `/api/wiki?slug=${slug}`,
      extract: (json) => (json as { data?: { items?: unknown[] } }).data?.items ?? [],
      apply: () => {},
    };
    await refreshOnce(opts, new AbortController().signal);
    slug = "beta";
    await refreshOnce(opts, new AbortController().signal);
    assert.deepEqual(seenUrls, ["/api/wiki?slug=alpha", "/api/wiki?slug=beta"]);
  });
});
