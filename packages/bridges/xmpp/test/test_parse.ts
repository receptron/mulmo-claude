import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitJid, bareJid, parseStanzaFields } from "../src/parse.js";

describe("splitJid", () => {
  it("splits user@domain into username and domain", () => {
    assert.deepEqual(splitJid("alice@example.com"), { username: "alice", domain: "example.com" });
  });

  it("returns empty fields for a JID with no @", () => {
    assert.deepEqual(splitJid("alice"), { username: "", domain: "" });
    assert.deepEqual(splitJid(""), { username: "", domain: "" });
  });

  it("treats a JID starting with @ as no username", () => {
    assert.deepEqual(splitJid("@example.com"), { username: "", domain: "example.com" });
  });

  it("preserves the resource part in the domain when present", () => {
    // splitJid does NOT strip resources — the domain field includes /resource.
    assert.deepEqual(splitJid("alice@example.com/phone"), { username: "alice", domain: "example.com/phone" });
  });
});

describe("bareJid", () => {
  it("strips the resource", () => {
    assert.equal(bareJid("alice@example.com/phone"), "alice@example.com");
  });

  it("returns the JID unchanged when there is no resource", () => {
    assert.equal(bareJid("alice@example.com"), "alice@example.com");
  });

  it("lowercases the result", () => {
    assert.equal(bareJid("Alice@Example.COM/Phone"), "alice@example.com");
    assert.equal(bareJid("BOB@DOMAIN.NET"), "bob@domain.net");
  });

  it("handles edge cases without throwing", () => {
    assert.equal(bareJid(""), "");
    assert.equal(bareJid("/"), "");
  });
});

describe("parseStanzaFields", () => {
  function fields(overrides: Partial<Parameters<typeof parseStanzaFields>[0]> = {}) {
    return {
      isMessage: true,
      type: "chat",
      from: "alice@example.com/phone",
      body: "hello",
      selfBare: "bot@example.com",
      ...overrides,
    };
  }

  it("returns the parsed message for a normal chat stanza", () => {
    assert.deepEqual(parseStanzaFields(fields()), {
      from: "alice@example.com/phone",
      senderBare: "alice@example.com",
      body: "hello",
    });
  });

  it("accepts type='normal' as well as 'chat'", () => {
    const out = parseStanzaFields(fields({ type: "normal" }));
    assert.equal(out?.body, "hello");
  });

  it("returns null when isMessage is false", () => {
    assert.equal(parseStanzaFields(fields({ isMessage: false })), null);
  });

  it("returns null for groupchat / headline / error types", () => {
    assert.equal(parseStanzaFields(fields({ type: "groupchat" })), null);
    assert.equal(parseStanzaFields(fields({ type: "headline" })), null);
    assert.equal(parseStanzaFields(fields({ type: "error" })), null);
  });

  it("treats missing type as default (returns null since no chat/normal)", () => {
    // Spec says missing type defaults to "normal" — but the bridge
    // mirrors the original index.ts behaviour, which used the bare
    // attrs.type and only allowed "chat"/"normal" exact strings.
    assert.equal(parseStanzaFields(fields({ type: undefined })), null);
  });

  it("returns null when from is missing or non-string", () => {
    assert.equal(parseStanzaFields(fields({ from: undefined })), null);
    assert.equal(parseStanzaFields(fields({ from: 42 })), null);
    assert.equal(parseStanzaFields(fields({ from: null })), null);
    assert.equal(parseStanzaFields(fields({ from: "" })), null);
  });

  it("returns null when body is missing or empty", () => {
    assert.equal(parseStanzaFields(fields({ body: null })), null);
    assert.equal(parseStanzaFields(fields({ body: "" })), null);
  });

  it("ignores echoes of our own message (senderBare === selfBare)", () => {
    assert.equal(parseStanzaFields(fields({ from: "bot@example.com/server", selfBare: "bot@example.com" })), null);
  });

  it("matches selfBare case-insensitively via bareJid lowercasing", () => {
    assert.equal(parseStanzaFields(fields({ from: "BOT@EXAMPLE.COM/server", selfBare: "bot@example.com" })), null);
  });

  it("preserves the full JID in the from field", () => {
    const out = parseStanzaFields(fields({ from: "alice@example.com/laptop" }));
    assert.equal(out?.from, "alice@example.com/laptop");
    assert.equal(out?.senderBare, "alice@example.com");
  });
});
