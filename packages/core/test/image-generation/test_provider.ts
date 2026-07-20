// Truth-table for `resolveImageProvider`. The rule set: an explicit,
// recognised provider wins unconditionally (even when its key is
// missing — the call then fails per-request with a clear error);
// otherwise the first available provider wins, defaulting to Gemini
// so today's error path is preserved.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveImageProvider } from "../../src/image-generation/provider.ts";
import type { ImageGenConfig } from "../../src/image-generation/types.ts";

function cfg(provider?: string): ImageGenConfig {
  return { provider };
}

describe("resolveImageProvider — explicit provider wins", () => {
  it("returns gemini when explicitly set, even with no keys", () => {
    assert.equal(resolveImageProvider(cfg("gemini"), false, false), "gemini");
  });

  it("returns openai when explicitly set, even when the OpenAI key is missing", () => {
    assert.equal(resolveImageProvider(cfg("openai"), true, false), "openai");
  });

  it("is case- and whitespace-insensitive", () => {
    assert.equal(resolveImageProvider(cfg(" OpenAI "), false, false), "openai");
    assert.equal(resolveImageProvider(cfg("GEMINI"), false, false), "gemini");
  });
});

describe("resolveImageProvider — availability fallback", () => {
  it("picks gemini when only Gemini is available", () => {
    assert.equal(resolveImageProvider(cfg(), true, false), "gemini");
  });

  it("picks openai when only OpenAI is available", () => {
    assert.equal(resolveImageProvider(cfg(), false, true), "openai");
  });

  it("prefers gemini when both are available", () => {
    assert.equal(resolveImageProvider(cfg(), true, true), "gemini");
  });

  it("defaults to gemini when neither is available (preserves the error path)", () => {
    assert.equal(resolveImageProvider(cfg(), false, false), "gemini");
  });
});

describe("resolveImageProvider — unrecognised / empty provider falls through", () => {
  it("treats an empty string as unset", () => {
    assert.equal(resolveImageProvider(cfg(""), false, true), "openai");
  });

  it("treats a typo as unset (falls to availability)", () => {
    assert.equal(resolveImageProvider(cfg("dall-e"), false, true), "openai");
    assert.equal(resolveImageProvider(cfg("dall-e"), true, false), "gemini");
  });
});
