import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSendPushBody, parseSendPushResult, sendWebPush, DEFAULT_SEND_PUSH_URL, type SendWebPushOptions } from "../src/index.js";

// A fetch stub that records its call and returns a scripted Response-like object.
const makeFetch = (impl: (url: string, init: RequestInit) => { ok: boolean; json: () => Promise<unknown> }) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init) as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};

const okOpts = (over: Partial<SendWebPushOptions> = {}): SendWebPushOptions => ({
  getIdToken: async () => "id-token-123",
  ...over,
});

test("buildSendPushBody wraps title/body in the onCall data envelope", () => {
  assert.deepEqual(JSON.parse(buildSendPushBody("✅ proj", "done")), { data: { title: "✅ proj", body: "done" } });
});

test("parseSendPushResult reads sent/failed/targets from the result envelope", () => {
  assert.deepEqual(parseSendPushResult({ result: { sent: 1, failed: 0, targets: 2 } }), { sent: 1, failed: 0, targets: 2 });
});

test("parseSendPushResult treats missing / non-number counts as 0", () => {
  assert.deepEqual(parseSendPushResult({ result: {} }), { sent: 0, failed: 0, targets: 0 });
  assert.deepEqual(parseSendPushResult({ result: { sent: "x", targets: null } }), { sent: 0, failed: 0, targets: 0 });
});

test("parseSendPushResult returns null when the shape isn't a result envelope", () => {
  assert.equal(parseSendPushResult(null), null);
  assert.equal(parseSendPushResult({}), null);
  assert.equal(parseSendPushResult({ result: 5 }), null);
  assert.equal(parseSendPushResult("nope"), null);
});

test("sendWebPush no-ops (returns null, never fetches) when getIdToken yields null", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ ok: true, json: async () => ({}) }));
  const result = await sendWebPush("✅ proj", "done", okOpts({ getIdToken: async () => null, fetchImpl }));
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test("sendWebPush no-ops when getIdToken rejects (auth SDK throws)", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ ok: true, json: async () => ({}) }));
  const result = await sendWebPush(
    "✅ proj",
    "done",
    okOpts({
      getIdToken: async () => {
        throw new Error("auth blew up");
      },
      fetchImpl,
    }),
  );
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test("sendWebPush POSTs the bearer token + data body and returns the parsed result", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ ok: true, json: async () => ({ result: { sent: 2, failed: 0, targets: 2 } }) }));
  const result = await sendWebPush("✅ proj", "done", okOpts({ fetchImpl }));
  assert.deepEqual(result, { sent: 2, failed: 0, targets: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DEFAULT_SEND_PUSH_URL);
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer id-token-123");
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { data: { title: "✅ proj", body: "done" } });
});

test("sendWebPush honours a custom url", async () => {
  const custom = "https://asia-northeast1-example.cloudfunctions.net/sendPush";
  const { fetchImpl, calls } = makeFetch(() => ({ ok: true, json: async () => ({ result: { sent: 1, failed: 0, targets: 1 } }) }));
  await sendWebPush("t", "b", okOpts({ fetchImpl, url: custom }));
  assert.equal(calls[0].url, custom);
});

test("sendWebPush returns null on a non-2xx response", async () => {
  const { fetchImpl } = makeFetch(() => ({ ok: false, json: async () => ({}) }));
  assert.equal(await sendWebPush("t", "b", okOpts({ fetchImpl })), null);
});

test("sendWebPush returns null (never throws) when fetch rejects", async () => {
  const fetchImpl = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.equal(await sendWebPush("t", "b", okOpts({ fetchImpl })), null);
});

test("sendWebPush returns null when the response body isn't valid JSON", async () => {
  const { fetchImpl } = makeFetch(() => ({
    ok: true,
    json: async () => {
      throw new Error("Unexpected token");
    },
  }));
  assert.equal(await sendWebPush("t", "b", okOpts({ fetchImpl })), null);
});

// --- FCM data payload (#2230) ---------------------------------------
// The routing map must reach FCM's `data` block so a receiver can act on the
// tap (e.g. open the session that just finished) instead of landing on the
// home screen.

test("buildSendPushBody nests the routing map under the onCall envelope", () => {
  assert.deepEqual(JSON.parse(buildSendPushBody("done", "ok", { sessionId: "abc123" })), {
    data: { title: "done", body: "ok", data: { sessionId: "abc123" } },
  });
});

test("buildSendPushBody omits data entirely when absent or empty", () => {
  // The envelope of an ordinary push must be unchanged by this feature —
  // sending `data: {}` would be noise the server has to reason about.
  assert.deepEqual(JSON.parse(buildSendPushBody("t", "b")), { data: { title: "t", body: "b" } });
  assert.deepEqual(JSON.parse(buildSendPushBody("t", "b", {})), { data: { title: "t", body: "b" } });
});

test("buildSendPushBody keeps title/body alongside data, never replacing them", () => {
  // Both mulmoserver receivers bail out when `notification` is missing, so a
  // data-only message is silently dropped — title/body must survive.
  const parsed = JSON.parse(buildSendPushBody("T", "B", { k: "v" })) as { data: Record<string, unknown> };
  assert.equal(parsed.data.title, "T");
  assert.equal(parsed.data.body, "B");
});

test("buildSendPushBody carries multiple routing keys verbatim", () => {
  const parsed = JSON.parse(buildSendPushBody("t", "b", { sessionId: "s1", kind: "stop" })) as { data: { data: unknown } };
  assert.deepEqual(parsed.data.data, { sessionId: "s1", kind: "stop" });
});

test("sendWebPush forwards options.data to the request body", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ ok: true, json: async () => ({ result: { sent: 1, failed: 0, targets: 1 } }) }));
  await sendWebPush("done", "ok", okOpts({ fetchImpl, data: { sessionId: "xyz" } }));
  assert.equal(calls.length, 1);
  const sent = JSON.parse(String(calls[0].init.body)) as { data: { data?: unknown } };
  assert.deepEqual(sent.data.data, { sessionId: "xyz" });
});

test("sendWebPush omits data when the caller passes none (back-compat)", async () => {
  const { fetchImpl, calls } = makeFetch(() => ({ ok: true, json: async () => ({ result: { sent: 1, failed: 0, targets: 1 } }) }));
  await sendWebPush("done", "ok", okOpts({ fetchImpl }));
  const sent = JSON.parse(String(calls[0].init.body)) as { data: Record<string, unknown> };
  assert.ok(!("data" in sent.data), `no routing block expected, got: ${JSON.stringify(sent)}`);
});
