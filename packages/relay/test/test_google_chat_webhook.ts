// Regression tests for the Google Chat JWT claim validator. Matches
// the pattern used in test_teams_webhook.ts: only the pure claim
// check is exercised here — crypto.subtle signature verification and
// JWKS fetch are out of scope.
//
// The key regression this guards against: the original code read
// `typeof payload.exp === "number" && payload.exp < now` — which
// silently accepted tokens that had no `exp` claim at all.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateGoogleChatClaims } from "../src/webhooks/google-chat.js";

const GOOGLE_CHAT_ISSUER = "chat@system.gserviceaccount.com";
const PROJECT_NUMBER = "123456789012";
const NOW_SEC = 1_700_000_000;

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: GOOGLE_CHAT_ISSUER,
    aud: PROJECT_NUMBER,
    exp: NOW_SEC + 300,
    ...overrides,
  };
}

describe("validateGoogleChatClaims", () => {
  it("accepts a well-formed payload", () => {
    assert.equal(validateGoogleChatClaims(basePayload(), PROJECT_NUMBER, NOW_SEC), true);
  });

  it("rejects wrong issuer", () => {
    assert.equal(validateGoogleChatClaims(basePayload({ iss: "spoofed@example.com" }), PROJECT_NUMBER, NOW_SEC), false);
  });

  it("rejects wrong audience", () => {
    assert.equal(validateGoogleChatClaims(basePayload({ aud: "999999999999" }), PROJECT_NUMBER, NOW_SEC), false);
  });

  it("accepts numeric aud that matches after String() coercion", () => {
    // Google occasionally sends aud as a number; String() in the
    // validator normalises that, matching the production callers.
    assert.equal(validateGoogleChatClaims(basePayload({ aud: Number(PROJECT_NUMBER) }), PROJECT_NUMBER, NOW_SEC), true);
  });

  it("rejects an expired token", () => {
    assert.equal(validateGoogleChatClaims(basePayload({ exp: NOW_SEC - 1 }), PROJECT_NUMBER, NOW_SEC), false);
  });

  it("rejects when exp claim is missing (fail-closed)", () => {
    const payload = basePayload();
    delete payload.exp;
    assert.equal(validateGoogleChatClaims(payload, PROJECT_NUMBER, NOW_SEC), false);
  });

  it("rejects when exp claim is non-numeric (fail-closed)", () => {
    assert.equal(validateGoogleChatClaims(basePayload({ exp: "not a number" }), PROJECT_NUMBER, NOW_SEC), false);
  });

  it("rejects when exp claim is null (fail-closed)", () => {
    assert.equal(validateGoogleChatClaims(basePayload({ exp: null }), PROJECT_NUMBER, NOW_SEC), false);
  });
});
