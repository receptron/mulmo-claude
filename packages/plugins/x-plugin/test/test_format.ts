import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTweetId, readUrlArg, tweetBody, formatTweet } from "../src/index";

test("extractTweetId: full x.com URL", () => {
  assert.equal(extractTweetId("https://x.com/jack/status/20"), "20");
});

test("extractTweetId: twitter.com URL with query", () => {
  assert.equal(extractTweetId("https://twitter.com/user/status/1234567890?s=20"), "1234567890");
});

test("extractTweetId: bare numeric id", () => {
  assert.equal(extractTweetId("987654321"), "987654321");
});

test("extractTweetId: non-status URL returns null", () => {
  assert.equal(extractTweetId("https://x.com/jack"), null);
});

test("tweetBody: note_tweet wins over text", () => {
  assert.equal(tweetBody({ id: "1", text: "short", note_tweet: { text: "the full long-form body" } }), "the full long-form body");
});

test("tweetBody: article.plain_text joins title + body", () => {
  assert.equal(tweetBody({ id: "1", text: "https://t.co/abc", article: { title: "Title", plain_text: "Body." } }), "Title\n\nBody.");
});

test("tweetBody: falls back to text", () => {
  assert.equal(tweetBody({ id: "1", text: "plain tweet" }), "plain tweet");
});

test("formatTweet: byline includes author + UTC date", () => {
  const out = formatTweet(
    { id: "1", text: "hi", created_at: "2026-04-11T08:30:00Z", public_metrics: { like_count: 3, retweet_count: 1, reply_count: 0 } },
    { id: "u1", name: "Jane", username: "jane" },
    "https://x.com/jane/status/1",
  );
  assert.match(out, /^@jane \(Jane\) · 2026-04-11/);
  assert.match(out, /Likes: 3 \| Retweets: 1 \| Replies: 0/);
  assert.match(out, /https:\/\/x\.com\/jane\/status\/1$/);
});

// `args` is model-generated, so `url` arrives as whatever JSON the model chose.
// Both directions matter here, and the first one is a regression this very
// change introduced before review caught it.
test("readUrlArg: a numeric tweet id is a legitimate model emission", () => {
  // The schema calls the field a "bare tweet ID", extractTweetId matches /^\d+$/,
  // and the failure message offers it — so {"url": 20} must keep working.
  assert.equal(readUrlArg(20), "20");
  assert.equal(extractTweetId(readUrlArg(20)), "20");
  assert.equal(readUrlArg(0), "0");
});

test("readUrlArg: objects and arrays are rejected, not stringified", () => {
  assert.equal(String({ url: "x" }), "[object Object]"); // the trap
  assert.equal(readUrlArg({ url: "x" }), "");
  assert.equal(readUrlArg(["https://x.com/jack/status/20"]), "");
  assert.equal(readUrlArg(null), "");
  assert.equal(readUrlArg(undefined), "");
});

test("readUrlArg: non-integer and unsafe numbers are not ids", () => {
  assert.equal(readUrlArg(1.5), "");
  assert.equal(readUrlArg(-20), "");
  assert.equal(readUrlArg(Number.MAX_SAFE_INTEGER + 2), "");
});
