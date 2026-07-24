// Tests for the pure helpers of `server/system/credentials.ts`.
// `looksLikeClaudeResponse` decides whether PTY output looks like a real Claude
// reply (conversational opener AND >= 20 chars) versus an error chunk that
// should time out. `readExpiresAt` narrows the Keychain blob to the token's
// expiry in epoch ms.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { looksLikeClaudeResponse, readExpiresAt } from "../../server/system/credentials.js";

describe("looksLikeClaudeResponse", () => {
  it("returns true for a conversational opener with enough text", () => {
    assert.equal(looksLikeClaudeResponse("Hello! How can I help you today?"), true);
  });

  it("returns true for an `I'm` opener (straight apostrophe) past the length floor", () => {
    assert.equal(looksLikeClaudeResponse("I'm here to help you out."), true);
  });

  it("returns true for an `I'm` opener (curly apostrophe) past the length floor", () => {
    assert.equal(looksLikeClaudeResponse("I’m ready to assist you now."), true);
  });

  it("returns false when the opener matches but the text is too short (< 20 chars)", () => {
    assert.equal(looksLikeClaudeResponse("Hi there"), false);
  });

  it("returns false at the boundary (exactly 19 chars, matching opener)", () => {
    const text = "Hi! short reply...."; // 19 chars, matches "Hi"
    assert.equal(text.length, 19);
    assert.equal(looksLikeClaudeResponse(text), false);
  });

  it("returns true at the boundary (exactly 20 chars, matching opener)", () => {
    const text = "Hi! twentycharsxxxxx"; // 20 chars, matches "Hi"
    assert.equal(text.length, 20);
    assert.equal(looksLikeClaudeResponse(text), true);
  });

  it("returns false for a login-error chunk", () => {
    assert.equal(looksLikeClaudeResponse("Please log in"), false);
  });

  it("returns false for an invalid-credentials chunk", () => {
    assert.equal(looksLikeClaudeResponse("Invalid credentials"), false);
  });

  it("returns false for long text without a conversational opener", () => {
    assert.equal(looksLikeClaudeResponse("Please log in to continue your session now."), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(looksLikeClaudeResponse(""), false);
  });
});

describe("readExpiresAt", () => {
  const wrap = (expiresAt: unknown) => JSON.stringify({ claudeAiOauth: { expiresAt } });

  it("returns the epoch-ms number when expiresAt is a number (the Keychain's real shape)", () => {
    // Regression: a `typeof === "string"` guard used to reject this, so a valid
    // token read as "no expiry → expired" and forced a renew on every run.
    assert.equal(readExpiresAt(wrap(1784602611420)), 1784602611420);
  });

  it("parses an ISO-8601 string expiresAt to epoch ms (legacy CLI shape)", () => {
    const iso = "2026-07-21T03:00:00.000Z";
    assert.equal(readExpiresAt(wrap(iso)), Date.parse(iso));
  });

  it("returns null when claudeAiOauth is absent", () => {
    assert.equal(readExpiresAt(JSON.stringify({ other: 1 })), null);
  });

  it("returns null when expiresAt is absent", () => {
    assert.equal(readExpiresAt(JSON.stringify({ claudeAiOauth: {} })), null);
  });

  it("returns null for a non-numeric, non-date string expiresAt", () => {
    assert.equal(readExpiresAt(wrap("not-a-date")), null);
  });

  it("returns null for a boolean expiresAt", () => {
    assert.equal(readExpiresAt(wrap(true)), null);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(readExpiresAt("{not json"), null);
  });

  it("returns null for a non-object top-level value", () => {
    assert.equal(readExpiresAt("42"), null);
    assert.equal(readExpiresAt("null"), null);
  });
});
