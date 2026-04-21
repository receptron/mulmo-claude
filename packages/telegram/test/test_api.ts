import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTelegramApi } from "../src/api.ts";

interface FakeCall {
  url: string;
  init?: Parameters<typeof fetch>[1];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

describe("TelegramApi.getUpdates", () => {
  let calls: FakeCall[];
  beforeEach(() => {
    calls = [];
  });

  const fetchStub = (script: (call: FakeCall) => Response | Promise<Response>): typeof fetch =>
    (async (input, init) => {
      const call: FakeCall = {
        url: typeof input === "string" ? input : input.toString(),
        init,
      };
      calls.push(call);
      return script(call);
    }) as typeof fetch;

  it("hits /getUpdates with offset and timeout query params", async () => {
    const api = createTelegramApi({
      botToken: "TKN",
      fetchImpl: fetchStub(() => jsonResponse({ ok: true, result: [] })),
    });
    await api.getUpdates({ offset: 42, timeoutSec: 25 });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/botTKN/getUpdates"));
    assert.ok(calls[0].url.includes("offset=42"));
    assert.ok(calls[0].url.includes("timeout=25"));
  });

  it("returns updates on success", async () => {
    const api = createTelegramApi({
      botToken: "TKN",
      fetchImpl: fetchStub(() =>
        jsonResponse({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                message_id: 1,
                chat: { id: 999, type: "private" },
                date: 0,
                text: "hi",
              },
            },
          ],
        }),
      ),
    });
    const updates = await api.getUpdates();
    assert.equal(updates.length, 1);
    assert.equal(updates[0].update_id, 1);
    assert.equal(updates[0].message?.text, "hi");
  });

  it("throws on non-2xx HTTP status", async () => {
    const api = createTelegramApi({
      botToken: "TKN",
      fetchImpl: fetchStub(() => textResponse("rate limited", 429)),
    });
    await assert.rejects(api.getUpdates(), /429/);
  });

  it("throws when the API response has ok=false", async () => {
    const api = createTelegramApi({
      botToken: "TKN",
      fetchImpl: fetchStub(() => jsonResponse({ ok: false, description: "Unauthorized" })),
    });
    await assert.rejects(api.getUpdates(), /Unauthorized/);
  });
});

describe("TelegramApi.sendMessage", () => {
  it("POSTs JSON with chat_id and text", async () => {
    const captured: { url?: string; body?: string } = {};
    const api = createTelegramApi({
      botToken: "TKN",
      fetchImpl: (async (input, init) => {
        captured.url = typeof input === "string" ? input : input.toString();
        captured.body = init?.body as string;
        return jsonResponse({ ok: true });
      }) as typeof fetch,
    });
    await api.sendMessage(123, "hello");
    assert.ok(captured.url?.endsWith("/sendMessage"));
    const parsed = JSON.parse(captured.body ?? "{}");
    assert.equal(parsed.chat_id, 123);
    assert.equal(parsed.text, "hello");
  });

  it("throws on API error", async () => {
    const api = createTelegramApi({
      botToken: "TKN",
      fetchImpl: (async () =>
        jsonResponse({
          ok: false,
          description: "chat not found",
        })) as typeof fetch,
    });
    await assert.rejects(api.sendMessage(1, "x"), /chat not found/);
  });
});
