// Regression tests for the Teams webhook security checks that landed
// alongside the plugin:
//
//   1. `serviceurl` JWT claim must equal the activity's serviceUrl
//      (SSRF protection — the reply path carries a Bearer token).
//   2. `activity.channelId` must be "msteams".
//   3. Signing key must be endorsed for `msteams` (MultiTenant only).
//   4. Allowlist must fail-closed when aadObjectId is missing.
//
// These tests cover the pure validators — the crypto.subtle signature
// check is not in scope here (would require fake-signing JWTs).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTokenClaims, validateJwkEndorsement, isAllowedSender, TEAMS_CHANNEL_ID } from "../src/webhooks/teams-verify.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const ISSUER = "https://api.botframework.com";
const NOW_SEC = 1_700_000_000;
const VALID_SERVICE_URL = "https://smba.trafficmanager.net/amer/";

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: APP_ID,
    exp: NOW_SEC + 300,
    serviceurl: VALID_SERVICE_URL,
    ...overrides,
  };
}

function baseActivity(overrides: Partial<{ serviceUrl: string; channelId: string }> = {}) {
  return {
    serviceUrl: VALID_SERVICE_URL,
    channelId: TEAMS_CHANNEL_ID,
    ...overrides,
  };
}

describe("validateTokenClaims", () => {
  it("passes when every claim lines up", () => {
    const ok = validateTokenClaims({
      payload: basePayload(),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity(),
    });
    assert.equal(ok, true);
  });

  it("accepts `aud` as an array", () => {
    const ok = validateTokenClaims({
      payload: basePayload({ aud: ["other-id", APP_ID] }),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity(),
    });
    assert.equal(ok, true);
  });

  it("rejects when issuer mismatches", () => {
    const ok = validateTokenClaims({
      payload: basePayload({ iss: "https://evil.example.com" }),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity(),
    });
    assert.equal(ok, false);
  });

  it("rejects when audience mismatches", () => {
    const ok = validateTokenClaims({
      payload: basePayload({ aud: "not-our-app" }),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity(),
    });
    assert.equal(ok, false);
  });

  it("rejects when token has expired", () => {
    const ok = validateTokenClaims({
      payload: basePayload({ exp: NOW_SEC - 1 }),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity(),
    });
    assert.equal(ok, false);
  });

  it("rejects when serviceurl claim is absent (fail-closed against SSRF)", () => {
    const payload = basePayload();
    delete payload.serviceurl;
    const ok = validateTokenClaims({
      payload,
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity(),
    });
    assert.equal(ok, false);
  });

  it("rejects when serviceurl claim does not match activity.serviceUrl", () => {
    // Attacker reuses a valid token but swaps the body's serviceUrl to
    // point the reply (carrying our Bearer token) at their endpoint.
    const ok = validateTokenClaims({
      payload: basePayload({ serviceurl: VALID_SERVICE_URL }),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity({ serviceUrl: "https://attacker.example.com/" }),
    });
    assert.equal(ok, false);
  });

  it("tolerates trailing-slash differences in serviceUrl", () => {
    const ok = validateTokenClaims({
      payload: basePayload({ serviceurl: "https://smba.trafficmanager.net/amer" }),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity({ serviceUrl: "https://smba.trafficmanager.net/amer/" }),
    });
    assert.equal(ok, true);
  });

  it("rejects when channelId is not `msteams`", () => {
    // Another Bot Framework channel's token must not be accepted here.
    const ok = validateTokenClaims({
      payload: basePayload(),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity({ channelId: "slack" }),
    });
    assert.equal(ok, false);
  });

  it("rejects when channelId is empty", () => {
    const ok = validateTokenClaims({
      payload: basePayload(),
      appId: APP_ID,
      expectedIssuer: ISSUER,
      nowSeconds: NOW_SEC,
      activity: baseActivity({ channelId: "" }),
    });
    assert.equal(ok, false);
  });
});

describe("validateJwkEndorsement", () => {
  it("passes when MultiTenant key lists msteams", () => {
    assert.equal(validateJwkEndorsement({ endorsements: ["msteams", "webchat"] }, "MultiTenant"), true);
  });

  it("rejects MultiTenant key without endorsements", () => {
    assert.equal(validateJwkEndorsement({}, "MultiTenant"), false);
  });

  it("rejects MultiTenant key whose endorsements omit msteams", () => {
    assert.equal(validateJwkEndorsement({ endorsements: ["slack", "webchat"] }, "MultiTenant"), false);
  });

  it("skips the endorsement requirement for SingleTenant (AAD JWKS has no endorsements)", () => {
    assert.equal(validateJwkEndorsement({}, "SingleTenant"), true);
    assert.equal(validateJwkEndorsement({ endorsements: ["slack"] }, "SingleTenant"), true);
  });
});

describe("isAllowedSender", () => {
  it("allows anyone when the allowlist is empty", () => {
    assert.equal(isAllowedSender({ allowed: new Set(), senderAadObjectId: "" }), true);
    assert.equal(isAllowedSender({ allowed: new Set(), senderAadObjectId: "any-id" }), true);
  });

  it("allows senders whose aadObjectId is on the list", () => {
    const allowed = new Set(["user-a", "user-b"]);
    assert.equal(isAllowedSender({ allowed, senderAadObjectId: "user-a" }), true);
  });

  it("rejects senders whose aadObjectId is not on the list", () => {
    const allowed = new Set(["user-a"]);
    assert.equal(isAllowedSender({ allowed, senderAadObjectId: "user-b" }), false);
  });

  it("rejects senders with a missing aadObjectId when the list is configured (fail-closed)", () => {
    // Previously: `allowed.size > 0 && activity.senderAadObjectId && !allowed.has(...)`
    // let senders through when aadObjectId was absent — a fail-open bug.
    const allowed = new Set(["user-a"]);
    assert.equal(isAllowedSender({ allowed, senderAadObjectId: "" }), false);
  });
});
