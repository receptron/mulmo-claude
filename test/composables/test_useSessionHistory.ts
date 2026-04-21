import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useSessionHistory } from "../../src/composables/useSessionHistory.js";

// These tests exercise the error-surfacing added for issue #280
// and the cursor-aware incremental fetch added for issue #205:
//   - a fetch failure must set `historyError` but leave `sessions`
//     untouched so the sidebar keeps showing its last known list
//   - the first call seeds from the full response; subsequent calls
//     send the server's cursor back as `?since=` and merge the diff

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

function mockJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

interface SummaryRow {
  id: string;
  roleId: string;
  startedAt: string;
  updatedAt: string;
  preview: string;
}

function row(id: string, updatedAt = ""): SummaryRow {
  return { id, roleId: "general", startedAt: "", updatedAt, preview: "" };
}

function envelope(sessions: SummaryRow[], cursor: string, deletedIds: string[] = []) {
  return { sessions, cursor, deletedIds };
}

describe("useSessionHistory — error surfacing (#280)", () => {
  it("sets historyError and keeps existing sessions on failure", async () => {
    const { sessions, historyError, fetchSessions } = useSessionHistory();

    // Prime the list with a successful fetch.
    stubFetch(async () => mockJsonResponse(200, envelope([row("s1")], "v1:1")));
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

    stubFetch(async () => mockJsonResponse(500, { error: "transient failure" }));
    await fetchSessions();
    assert.ok(historyError.value);

    stubFetch(async () => mockJsonResponse(200, envelope([], "v1:1")));
    await fetchSessions();
    assert.equal(historyError.value, null);
  });

  it("returns the stale list (not empty) when a failure follows success", async () => {
    const { fetchSessions } = useSessionHistory();

    stubFetch(async () => mockJsonResponse(200, envelope([row("a"), row("b")], "v1:1")));
    const first = await fetchSessions();
    assert.equal(first.length, 2);

    stubFetch(async () => mockJsonResponse(503, { error: "down" }));
    const second = await fetchSessions();
    // Previous behaviour returned []; new behaviour returns the stale
    // list so the caller doesn't have to re-read `.sessions` separately.
    assert.equal(second.length, 2);
  });
});

describe("useSessionHistory — cursor-aware incremental fetch (#205)", () => {
  it("sends no `since` param on the first call, full response seeds the cache", async () => {
    const { sessions, fetchSessions } = useSessionHistory();
    let capturedUrl = "";
    stubFetch(async (url) => {
      capturedUrl = String(url);
      return mockJsonResponse(200, envelope([row("a", "2026-04-17T01:00:00.000Z")], "v1:100"));
    });
    await fetchSessions();
    assert.ok(!capturedUrl.includes("since="), `first call should omit ?since=, got: ${capturedUrl}`);
    assert.equal(sessions.value.length, 1);
  });

  it("echoes the server cursor back on the second call", async () => {
    const { fetchSessions } = useSessionHistory();
    stubFetch(async () => mockJsonResponse(200, envelope([row("a")], "v1:1234")));
    await fetchSessions();

    let capturedUrl = "";
    stubFetch(async (url) => {
      capturedUrl = String(url);
      return mockJsonResponse(200, envelope([], "v1:1234"));
    });
    await fetchSessions();

    // URLs are built by apiGet via URLSearchParams — `v1:1234`
    // encodes to `v1%3A1234`. Check both forms to stay robust.
    assert.ok(capturedUrl.includes("since=v1%3A1234") || capturedUrl.includes("since=v1:1234"), `second call must carry the cursor, got: ${capturedUrl}`);
  });

  it("merges diffs into the cache (upsert + preserved rows)", async () => {
    const { sessions, fetchSessions } = useSessionHistory();
    // Seed with two sessions.
    stubFetch(async () => mockJsonResponse(200, envelope([row("a", "2026-04-17T01:00:00.000Z"), row("b", "2026-04-17T02:00:00.000Z")], "v1:1")));
    await fetchSessions();

    // Diff: `a` gets a newer updatedAt, `c` is new, `b` is unchanged
    // and NOT returned in the diff. Cache must still contain b.
    stubFetch(async () =>
      mockJsonResponse(200, envelope([{ ...row("a", "2026-04-17T03:00:00.000Z"), preview: "updated" }, row("c", "2026-04-17T00:30:00.000Z")], "v1:2")),
    );
    await fetchSessions();

    const ids = sessions.value.map((session) => session.id);
    assert.deepEqual(ids.sort(), ["a", "b", "c"].sort(), "diff should upsert a/c while preserving untouched b");
    const sessionA = sessions.value.find((session) => session.id === "a");
    assert.equal(sessionA?.preview, "updated", "a must have the diff's fields");
  });

  it("removes cached rows whose id appears in deletedIds", async () => {
    const { sessions, fetchSessions } = useSessionHistory();
    stubFetch(async () => mockJsonResponse(200, envelope([row("a"), row("b"), row("c")], "v1:1")));
    await fetchSessions();
    assert.equal(sessions.value.length, 3);

    stubFetch(async () => mockJsonResponse(200, envelope([], "v1:2", ["b"])));
    await fetchSessions();
    const ids = sessions.value.map((session) => session.id).sort();
    assert.deepEqual(ids, ["a", "c"]);
  });
});
