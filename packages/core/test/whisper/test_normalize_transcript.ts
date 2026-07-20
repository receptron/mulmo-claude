import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeTranscript } from "../../src/whisper/whisper.ts";

describe("normalizeTranscript", () => {
  it("trims and collapses internal whitespace", () => {
    assert.equal(normalizeTranscript("  hello   world  "), "hello world");
  });

  it("drops whisper.cpp blank sentinels", () => {
    assert.equal(normalizeTranscript("[blank_audio]"), "");
    assert.equal(normalizeTranscript("(silence)"), "");
    assert.equal(normalizeTranscript("[ inaudible ]"), "");
  });

  it("drops the classic Japanese YouTube-caption hallucinations", () => {
    assert.equal(normalizeTranscript("ご視聴ありがとうございました"), "");
    assert.equal(normalizeTranscript("ご視聴ありがとうございました。"), "");
    assert.equal(normalizeTranscript("またお会いしましょう"), "");
    assert.equal(normalizeTranscript("チャンネル登録をお願いします"), "");
  });

  it("drops repeated / punctuated hallucination runs", () => {
    assert.equal(normalizeTranscript("ご視聴ありがとうございました。ご視聴ありがとうございました。"), "");
    assert.equal(normalizeTranscript("ありがとうございました、ありがとうございました！"), "");
  });

  it("drops the English equivalents", () => {
    assert.equal(normalizeTranscript("Thank you for watching."), "");
    assert.equal(normalizeTranscript("Please subscribe!"), "");
  });

  it("keeps genuine speech that merely contains a boilerplate phrase", () => {
    assert.equal(normalizeTranscript("動画をご視聴ありがとうございました、では本題に入ります"), "動画をご視聴ありがとうございました、では本題に入ります");
    assert.equal(normalizeTranscript("会議の時間を教えて"), "会議の時間を教えて");
    assert.equal(normalizeTranscript("Thank you for the report, can you resend it?"), "Thank you for the report, can you resend it?");
  });
});
