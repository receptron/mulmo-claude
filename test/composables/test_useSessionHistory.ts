import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useSessionHistory } from "../../src/composables/useSessionHistory.js";

// These tests exercise the error-surfacing added for issue #280:
// a fetch failure must set `historyError` but leave `sessions`
// untouched so the sidebar keeps showing its last known list.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalFetch: any = (globalThis as any).fetch;

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = originalFetch;
});

function stubFetch(
  impl: (input: unknown, init?: unknown) => Promise<Response>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = impl;
}

function mockJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("useSessionHistory — error surfacing (#280)", () => {
  it("sets historyError and keeps existing sessions on failure", async () => {
    const { sessions, historyError, fetchSessions } = useSessionHistory();

    // Prime the list with a successful fetch.
    stubFetch(async () =>
      mockJsonResponse(200, [
        {
          id: "s1",
          roleId: "general",
          startedAt: "",
          updatedAt: "",
          preview: "",
        },
      ]),
    );
    await fetchSessions();
    assert.equal(sessions.value.length, 1);
    assert.equal(historyError.value, null);

    // Simulate a 500 — the existing list must survive.
    stubFetch(async () => mockJsonResponse(500, { error: "server exploded" }));
    const result = await fetchSessions();

    assert.equal(sessions.value.length, 1, "sessions preserved on failure");
    assert.equal(result.length, 1);
    assert.equal(typeof historyError.value, "string");
    assert.ok((historyError.value ?? "").length > 0, "historyError populated");
  });

  it("clears historyError on the next successful fetch", async () => {
    const { historyError, fetchSessions } = useSessionHistory();

    stubFetch(async () =>
      mockJsonResponse(500, { error: "transient failure" }),
    );
    await fetchSessions();
    assert.ok(historyError.value);

    stubFetch(async () => mockJsonResponse(200, []));
    await fetchSessions();
    assert.equal(historyError.value, null);
  });

  it("returns the stale list (not empty) when a failure follows success", async () => {
    const { fetchSessions } = useSessionHistory();

    stubFetch(async () =>
      mockJsonResponse(200, [
        {
          id: "a",
          roleId: "general",
          startedAt: "",
          updatedAt: "",
          preview: "",
        },
        {
          id: "b",
          roleId: "general",
          startedAt: "",
          updatedAt: "",
          preview: "",
        },
      ]),
    );
    const first = await fetchSessions();
    assert.equal(first.length, 2);

    stubFetch(async () => mockJsonResponse(503, { error: "down" }));
    const second = await fetchSessions();
    // Previous behaviour returned []; new behaviour returns the stale
    // list so the caller doesn't have to re-read `.sessions` separately.
    assert.equal(second.length, 2);
  });
});
