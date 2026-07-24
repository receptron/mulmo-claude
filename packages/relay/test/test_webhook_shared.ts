// Unit tests for the shared webhook helpers extracted in #2402:
//   - jwt.ts        b64UrlDecode / parseJwt / jwtHashAlg (pure)
//   - relay-message.ts  makeRelayMessage (envelope factory)
//   - respond.ts    postJsonChunks (chunked authenticated POST + errors)
//
// The crypto.subtle signature verify (verifyJwtSignature) is out of scope
// here — like the sibling claim-validator tests, it would need fake-signed
// JWTs. These cover the parse/format logic that fails silently when wrong.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { b64UrlDecode, parseJwt, jwtHashAlg, type ParsedJwt } from "../src/webhooks/jwt.js";
import { makeRelayMessage } from "../src/webhooks/relay-message.js";
import { postJsonChunks } from "../src/webhooks/respond.js";

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(header: Record<string, unknown>): ParsedJwt {
  return { header, payload: {}, signInput: "", sig: new Uint8Array() };
}

describe("b64UrlDecode", () => {
  it("decodes an unpadded base64url segment", () => {
    assert.deepEqual(Array.from(b64UrlDecode("aGVsbG8")), [104, 101, 108, 108, 111]); // "hello"
  });

  it("maps the url-safe alphabet (- _) back to + /", () => {
    // base64url "-_8" ⇢ standard "+/8=" ⇢ bytes 0xFB 0xFF
    assert.deepEqual(Array.from(b64UrlDecode("-_8")), [0xfb, 0xff]);
  });

  it("returns an empty array for an empty string", () => {
    assert.equal(b64UrlDecode("").length, 0);
  });
});

describe("parseJwt", () => {
  it("parses a well-formed three-segment token", () => {
    const header = b64url({ alg: "RS256", kid: "key-1" });
    const payload = b64url({ sub: "user-42" });
    const jwt = parseJwt(`${header}.${payload}.AAAA`);
    assert.notEqual(jwt, null);
    assert.equal(jwt?.header.alg, "RS256");
    assert.equal(jwt?.header.kid, "key-1");
    assert.equal(jwt?.payload.sub, "user-42");
    assert.equal(jwt?.signInput, `${header}.${payload}`);
    assert.ok(jwt?.sig instanceof Uint8Array);
  });

  it("returns null when the segment count is not three", () => {
    assert.equal(parseJwt("only.two"), null);
    assert.equal(parseJwt("a.b.c.d"), null);
  });

  it("returns null when a segment is not valid base64url", () => {
    assert.equal(parseJwt("!!!.!!!.!!!"), null);
  });

  it("returns null when a segment is valid base64url but not JSON", () => {
    const notJson = Buffer.from("notjson").toString("base64url");
    assert.equal(parseJwt(`${notJson}.${notJson}.AAAA`), null);
  });
});

describe("jwtHashAlg", () => {
  it("defaults to SHA-256 when alg is absent", () => {
    assert.equal(jwtHashAlg(fakeJwt({})), "SHA-256");
  });

  it("maps the RS family to its digest", () => {
    assert.equal(jwtHashAlg(fakeJwt({ alg: "RS256" })), "SHA-256");
    assert.equal(jwtHashAlg(fakeJwt({ alg: "RS384" })), "SHA-384");
    assert.equal(jwtHashAlg(fakeJwt({ alg: "RS512" })), "SHA-512");
  });

  it("falls through to SHA-512 for any other alg", () => {
    assert.equal(jwtHashAlg(fakeJwt({ alg: "ES256" })), "SHA-512");
  });
});

describe("makeRelayMessage", () => {
  it("maps the platform/sender/chat/text fields and stamps id + receivedAt", () => {
    const msg = makeRelayMessage({ platform: "whatsapp", senderId: "s1", chatId: "c1", text: "hi" });
    assert.equal(msg.platform, "whatsapp");
    assert.equal(msg.senderId, "s1");
    assert.equal(msg.chatId, "c1");
    assert.equal(msg.text, "hi");
    assert.equal(msg.id.length, 36);
    assert.equal(Number.isNaN(Date.parse(msg.receivedAt)), false);
  });

  it("omits replyToken entirely when not supplied", () => {
    const msg = makeRelayMessage({ platform: "messenger", senderId: "s", chatId: "c", text: "t" });
    assert.equal("replyToken" in msg, false);
  });

  it("keeps replyToken when supplied", () => {
    const msg = makeRelayMessage({ platform: "teams", senderId: "s", chatId: "c", text: "t", replyToken: "https://svc/" });
    assert.equal(msg.replyToken, "https://svc/");
  });
});

describe("postJsonChunks", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("POSTs the built body to the endpoint with a bearer token", async () => {
    const calls: { url: string; authorization: string; body: string }[] = [];
    globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, authorization: init.headers.Authorization, body: init.body });
      return { ok: true } as Response;
    }) as typeof fetch;

    await postJsonChunks({
      text: "hi",
      maxTextLength: 2000,
      label: "WhatsApp",
      endpoint: "https://example.test/send",
      accessToken: "tok",
      buildBody: (chunk) => ({ msg: chunk }),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.test/send");
    assert.equal(calls[0].authorization, "Bearer tok");
    assert.equal(calls[0].body, JSON.stringify({ msg: "hi" }));
  });

  it("wraps a network error with the platform label", async () => {
    globalThis.fetch = (async () => {
      throw new Error("boom");
    }) as typeof fetch;

    await assert.rejects(
      () =>
        postJsonChunks({
          text: "hi",
          maxTextLength: 2000,
          label: "Messenger",
          endpoint: "https://example.test/send",
          accessToken: "tok",
          buildBody: (chunk) => ({ msg: chunk }),
        }),
      /Messenger API network error: boom/,
    );
  });

  it("throws a labelled error with the status and response detail on non-2xx", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 500,
        text: async () => "upstream detail",
      }) as unknown as Response) as typeof fetch;

    await assert.rejects(
      () =>
        postJsonChunks({
          text: "hi",
          maxTextLength: 2000,
          label: "Teams",
          endpoint: "https://example.test/send",
          accessToken: "tok",
          buildBody: (chunk) => ({ msg: chunk }),
        }),
      /Teams API failed: 500 upstream detail/,
    );
  });
});
