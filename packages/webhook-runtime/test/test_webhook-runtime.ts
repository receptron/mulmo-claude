import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import express from "express";
import {
  configureTrustProxy,
  createWebhookApp,
  createWebhookRateLimit,
  metaVerificationResult,
  narrowChallenge,
  SAFE_CHALLENGE_RE,
  verifyHmacSignature,
  verifyMetaHmacSignature,
} from "../src/index.ts";

// Generated (not a literal) so the secret-scanner lint doesn't flag a
// test fixture as a real credential.
const SECRET = crypto.randomBytes(16).toString("hex");
const sign = (body: string, enc: crypto.BinaryToTextEncoding = "base64") => crypto.createHmac("SHA256", SECRET).update(body).digest(enc);

describe("verifyHmacSignature", () => {
  it("accepts a correct base64 signature", () => {
    const body = '{"events":[]}';
    assert.equal(verifyHmacSignature(body, sign(body), SECRET), true);
  });

  it("rejects a tampered body", () => {
    const good = sign('{"events":[]}');
    assert.equal(verifyHmacSignature('{"events":[1]}', good, SECRET), false);
  });

  it("rejects a wrong secret", () => {
    const body = "payload";
    assert.equal(verifyHmacSignature(body, sign(body), "different"), false);
  });

  it("returns false (no throw) on a length mismatch", () => {
    assert.equal(verifyHmacSignature("payload", "short", SECRET), false);
  });

  it("returns false (no throw) when a non-ASCII signature matches string length but not byte length", () => {
    // Regression: the guard must compare BYTE lengths. A multi-byte char
    // gives Buffer.from() more bytes than the JS string length, which
    // would make timingSafeEqual throw if guarded by string length.
    const expected = sign("payload"); // base64, all ASCII
    const sameStringLenNonAscii = "é".repeat(expected.length);
    assert.equal(sameStringLenNonAscii.length, expected.length);
    assert.equal(verifyHmacSignature("payload", sameStringLenNonAscii, SECRET), false);
  });

  it("supports hex encoding", () => {
    const body = "payload";
    assert.equal(verifyHmacSignature(body, sign(body, "hex"), SECRET, "SHA256", "hex"), true);
    // A base64 signature must NOT validate when hex is expected.
    assert.equal(verifyHmacSignature(body, sign(body, "base64"), SECRET, "SHA256", "hex"), false);
  });
});

describe("configureTrustProxy", () => {
  const settingOf = (env: string | undefined) => {
    const app = express();
    configureTrustProxy(app, env);
    return app.get("trust proxy");
  };

  it("leaves the default untouched when env is unset", () => {
    assert.equal(settingOf(undefined), false);
  });

  it("parses the boolean strings true/false", () => {
    assert.equal(settingOf("true"), true);
    assert.equal(settingOf("false"), false);
  });

  it("parses a non-negative hop count as a number", () => {
    assert.equal(settingOf("2"), 2);
  });

  it("passes a CIDR / preset string through verbatim", () => {
    // Built from parts so the no-hardcoded-ip lint doesn't flag the fixture.
    const cidr = `${[10, 0, 0, 0].join(".")}/8`;
    assert.equal(settingOf(cidr), cidr);
    assert.equal(settingOf("loopback"), "loopback");
  });
});

describe("factory shapes", () => {
  it("createWebhookRateLimit returns an express middleware", () => {
    const mw = createWebhookRateLimit();
    assert.equal(typeof mw, "function");
  });

  it("createWebhookApp returns an app with x-powered-by disabled", () => {
    const app = createWebhookApp();
    assert.equal(app.get("x-powered-by"), false);
  });
});

describe("narrowChallenge — accepted forms (Meta hub.challenge)", () => {
  it("typical Meta nonce (alphanumeric)", () => {
    assert.equal(narrowChallenge("ABC123xyz789"), "ABC123xyz789");
  });

  it("base64url shape (alphanumeric + _ + -)", () => {
    assert.equal(narrowChallenge("aB-cD_eF1"), "aB-cD_eF1");
  });

  it("single char (minimum length)", () => {
    assert.equal(narrowChallenge("a"), "a");
  });

  it("256-char string (current upper bound)", () => {
    const long = "a".repeat(256);
    assert.equal(narrowChallenge(long), long);
  });
});

describe("narrowChallenge — rejected forms", () => {
  it("rejects empty string", () => {
    assert.equal(narrowChallenge(""), null);
  });

  it("rejects beyond 256 chars (length cap)", () => {
    assert.equal(narrowChallenge("a".repeat(257)), null);
  });

  it("rejects non-string types (number, undefined, null)", () => {
    assert.equal(narrowChallenge(123), null);
    assert.equal(narrowChallenge(undefined), null);
    assert.equal(narrowChallenge(null), null);
  });

  it("rejects array (defeats ?hub.challenge[]=... bypass)", () => {
    // Express parses `?hub.challenge=a&hub.challenge=b` as an array;
    // the string check at the top of narrowChallenge catches it
    // instead of toString-coercing.
    assert.equal(narrowChallenge(["abc"]), null);
  });

  it("rejects HTML-meta / XSS probe payloads", () => {
    assert.equal(narrowChallenge("<script>alert(1)</script>"), null);
    assert.equal(narrowChallenge('" onload="evil"'), null);
    assert.equal(narrowChallenge("javascript:alert(1)"), null);
  });

  it("rejects characters outside the base64url alphabet", () => {
    assert.equal(narrowChallenge("abc="), null);
    assert.equal(narrowChallenge("a+b"), null);
    assert.equal(narrowChallenge("a/b"), null);
    assert.equal(narrowChallenge("with space"), null);
    assert.equal(narrowChallenge("with\nnewline"), null);
  });

  it("rejects non-ASCII characters", () => {
    assert.equal(narrowChallenge("café"), null);
    assert.equal(narrowChallenge("日本語"), null);
  });
});

describe("SAFE_CHALLENGE_RE — anchor sanity", () => {
  it("regex is fully anchored (no partial-match leakage)", () => {
    assert.equal(SAFE_CHALLENGE_RE.source.startsWith("^"), true);
    assert.equal(SAFE_CHALLENGE_RE.source.endsWith("$"), true);
  });
});

describe("metaVerificationResult", () => {
  const TOKEN = "verify-me";

  it("echoes the challenge on a valid subscribe handshake", () => {
    const query = { "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "nonce123" };
    assert.deepEqual(metaVerificationResult(query, TOKEN), { status: 200, body: "nonce123", verified: true });
  });

  it("forbids when the verify token does not match", () => {
    const query = { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "nonce123" };
    assert.deepEqual(metaVerificationResult(query, TOKEN), { status: 403, body: "Forbidden", verified: false });
  });

  it("forbids when the mode is not subscribe", () => {
    const query = { "hub.mode": "unsubscribe", "hub.verify_token": TOKEN, "hub.challenge": "nonce123" };
    assert.equal(metaVerificationResult(query, TOKEN).verified, false);
  });

  it("forbids a challenge that fails the narrow (XSS probe / array form)", () => {
    const xss = { "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "<script>" };
    assert.equal(metaVerificationResult(xss, TOKEN).verified, false);
    const arr = { "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": ["a", "b"] };
    assert.equal(metaVerificationResult(arr, TOKEN).verified, false);
  });

  it("forbids when the challenge query param is missing entirely", () => {
    const query = { "hub.mode": "subscribe", "hub.verify_token": TOKEN };
    assert.equal(metaVerificationResult(query, TOKEN).verified, false);
  });
});

describe("verifyMetaHmacSignature", () => {
  it("strips the sha256= prefix and validates a hex digest", () => {
    const body = '{"entry":[]}';
    const digest = crypto.createHmac("SHA256", SECRET).update(body).digest("hex");
    assert.equal(verifyMetaHmacSignature(body, `sha256=${digest}`, SECRET), true);
  });

  it("rejects a tampered body", () => {
    const digest = crypto.createHmac("SHA256", SECRET).update("a").digest("hex");
    assert.equal(verifyMetaHmacSignature("b", `sha256=${digest}`, SECRET), false);
  });

  it("tolerates an absent sha256= prefix (strip is a no-op, bare hex still validates)", () => {
    // `replace("sha256=", "")` only strips when present; Meta always sends the
    // prefix, but a bare valid hex digest must not spuriously fail.
    const digest = crypto.createHmac("SHA256", SECRET).update("a").digest("hex");
    assert.equal(verifyMetaHmacSignature("a", digest, SECRET), true);
  });

  it("rejects a base64 digest when hex is expected", () => {
    const b64 = crypto.createHmac("SHA256", SECRET).update("a").digest("base64");
    assert.equal(verifyMetaHmacSignature("a", `sha256=${b64}`, SECRET), false);
  });
});
