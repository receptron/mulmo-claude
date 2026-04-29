import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isObj, htmlToText, stripLeadingMentions, parseMentionStatus, parseNotificationRaw, parseFrame } from "../src/parse.js";

describe("isObj", () => {
  it("returns true for plain objects and arrays", () => {
    assert.equal(isObj({}), true);
    assert.equal(isObj({ a: 1 }), true);
    assert.equal(isObj([]), true);
  });

  it("returns false for null / primitives", () => {
    assert.equal(isObj(null), false);
    assert.equal(isObj(undefined), false);
    assert.equal(isObj("str"), false);
    assert.equal(isObj(42), false);
    assert.equal(isObj(true), false);
  });
});

describe("htmlToText", () => {
  it("strips paragraph tags and converts to plain text", () => {
    assert.equal(htmlToText("<p>Hello world</p>"), "Hello world");
  });

  it("turns <br> into newlines", () => {
    assert.equal(htmlToText("a<br>b<br/>c<br />d"), "a\nb\nc\nd");
  });

  it("turns </p><p> into double newlines", () => {
    assert.equal(htmlToText("<p>line1</p><p>line2</p>"), "line1\n\nline2");
  });

  it("decodes HTML entities", () => {
    assert.equal(htmlToText("a &amp; b &lt;x&gt; &quot;y&quot; &#39;z&#39; &nbsp;w"), "a & b <x> \"y\" 'z'  w");
  });

  it("returns empty string for empty / whitespace-only input", () => {
    assert.equal(htmlToText(""), "");
    assert.equal(htmlToText("   "), "");
  });

  it("handles malformed tags by walking char-by-char", () => {
    // unbalanced < without > — the rest is in tag state, never closes
    assert.equal(htmlToText("hello <world"), "hello");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(htmlToText("  <p>  body  </p>  "), "body");
  });
});

describe("stripLeadingMentions", () => {
  it("strips a single leading mention", () => {
    assert.equal(stripLeadingMentions("@bot hello"), "hello");
  });

  it("strips multiple leading mentions iteratively", () => {
    assert.equal(stripLeadingMentions("@bot @other@instance.example hello"), "hello");
  });

  it("strips federated mentions with instance", () => {
    assert.equal(stripLeadingMentions("@bot@example.social good morning"), "good morning");
  });

  it("does not strip mid-text mentions", () => {
    assert.equal(stripLeadingMentions("hello @bot"), "hello @bot");
  });

  it("returns trimmed text when there are no mentions", () => {
    assert.equal(stripLeadingMentions("  bare body  "), "bare body");
  });

  it("returns empty string when input is only mentions", () => {
    assert.equal(stripLeadingMentions("@a @b@c.d "), "");
  });

  it("does not loop infinitely on adversarial input without trailing space", () => {
    // No trailing space → no match → no strip → returns trimmed input.
    const adversarial = "@a@a@a@a@a";
    assert.equal(stripLeadingMentions(adversarial), adversarial);
  });
});

describe("parseMentionStatus", () => {
  function notif(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "mention",
      status: {
        id: "s1",
        visibility: "direct",
        account: { acct: "alice@example.social" },
        content: "<p>hello</p>",
        media_attachments: [],
        ...((overrides.status as Record<string, unknown> | undefined) ?? {}),
      },
      ...overrides,
    };
  }

  it("parses a normal mention notification", () => {
    const out = parseMentionStatus(notif());
    assert.deepEqual(out, {
      statusId: "s1",
      senderAcct: "alice@example.social",
      visibility: "direct",
      text: "hello",
      media: [],
    });
  });

  it("strips leading bot mention from text", () => {
    const out = parseMentionStatus(notif({ status: { id: "s1", visibility: "direct", account: { acct: "alice" }, content: "<p>@bot hi there</p>" } }));
    assert.equal(out?.text, "hi there");
  });

  it("returns null when type is not 'mention'", () => {
    assert.equal(parseMentionStatus({ ...notif(), type: "follow" }), null);
    assert.equal(parseMentionStatus({ ...notif(), type: "favourite" }), null);
  });

  it("returns null when status is missing or non-object", () => {
    assert.equal(parseMentionStatus({ type: "mention" }), null);
    assert.equal(parseMentionStatus({ type: "mention", status: "string" }), null);
    assert.equal(parseMentionStatus({ type: "mention", status: null }), null);
  });

  it("returns null when status.id is missing", () => {
    assert.equal(parseMentionStatus(notif({ status: { visibility: "direct", account: { acct: "alice" }, content: "<p>x</p>" } })), null);
  });

  it("returns null when account.acct is missing", () => {
    assert.equal(parseMentionStatus(notif({ status: { id: "s1", visibility: "direct", account: {}, content: "<p>x</p>" } })), null);
    assert.equal(parseMentionStatus(notif({ status: { id: "s1", visibility: "direct", content: "<p>x</p>" } })), null);
  });

  it("defaults visibility to 'public' when missing", () => {
    const out = parseMentionStatus(notif({ status: { id: "s1", account: { acct: "alice" }, content: "<p>x</p>" } }));
    assert.equal(out?.visibility, "public");
  });

  it("defaults content to empty string when missing", () => {
    const out = parseMentionStatus(notif({ status: { id: "s1", account: { acct: "alice" } } }));
    assert.equal(out?.text, "");
  });
});

describe("parseNotificationRaw", () => {
  it("parses a valid notification JSON", () => {
    const raw = JSON.stringify({ type: "mention", status: { id: "s1", visibility: "direct", account: { acct: "alice" }, content: "<p>hi</p>" } });
    const out = parseNotificationRaw(raw);
    assert.equal(out?.statusId, "s1");
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseNotificationRaw("not json"), null);
    assert.equal(parseNotificationRaw(""), null);
    assert.equal(parseNotificationRaw("{"), null);
  });

  it("returns null for non-object JSON", () => {
    assert.equal(parseNotificationRaw("null"), null);
    assert.equal(parseNotificationRaw("42"), null);
    assert.equal(parseNotificationRaw('"string"'), null);
  });

  it("returns null when notification type is not 'mention'", () => {
    const raw = JSON.stringify({ type: "favourite", status: { id: "s1" } });
    assert.equal(parseNotificationRaw(raw), null);
  });
});

describe("parseFrame", () => {
  it("parses a valid event frame", () => {
    const raw = JSON.stringify({ event: "notification", payload: '{"type":"mention"}' });
    assert.deepEqual(parseFrame(raw), { event: "notification", payload: '{"type":"mention"}' });
  });

  it("returns null for non-string input", () => {
    assert.equal(parseFrame(null), null);
    assert.equal(parseFrame(42), null);
    assert.equal(parseFrame({}), null);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseFrame("not json"), null);
  });

  it("returns null when event or payload is missing / non-string", () => {
    assert.equal(parseFrame(JSON.stringify({ payload: "x" })), null);
    assert.equal(parseFrame(JSON.stringify({ event: "x" })), null);
    assert.equal(parseFrame(JSON.stringify({ event: 1, payload: "x" })), null);
    assert.equal(parseFrame(JSON.stringify({ event: "x", payload: 1 })), null);
    assert.equal(parseFrame(JSON.stringify({ event: "", payload: "x" })), null);
    assert.equal(parseFrame(JSON.stringify({ event: "x", payload: "" })), null);
  });
});
