// `Env` is `[key: string]: unknown`, so every secret read used to go through
// `String(env.X ?? "")`. That yields a plausible-looking string for values that
// are not secrets at all — "undefined" for an unset binding, "[object Object]"
// for a mistyped one — which then gets sent to a platform API as a credential or
// fed to a signature check.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { envSecret, requireEnvSecret } from "../src/utils/envSecret.js";
import type { Env } from "../src/types.js";

const envWith = (values: Record<string, unknown>): Env => ({ RELAY: null, RELAY_TOKEN: "t", ...values }) as Env;

describe("envSecret", () => {
  it("returns a configured secret", () => {
    assert.equal(envSecret(envWith({ TOKEN: "abc123" }), "TOKEN"), "abc123");
  });

  // The shape this actually guards against: `wrangler secret put < token.txt`
  // stores the file's trailing newline, which then goes out in an Authorization
  // header and comes back as an unexplained 401.
  it("trims surrounding whitespace", () => {
    assert.equal(envSecret(envWith({ TOKEN: "abc123\n" }), "TOKEN"), "abc123");
    assert.equal(envSecret(envWith({ TOKEN: "  abc123  " }), "TOKEN"), "abc123");
  });

  it("leaves whitespace inside a secret alone", () => {
    assert.equal(envSecret(envWith({ TOKEN: "ab c123" }), "TOKEN"), "ab c123");
  });

  it("returns null for an unset binding", () => {
    assert.equal(envSecret(envWith({}), "TOKEN"), null);
  });

  it("returns null for a blank secret", () => {
    assert.equal(envSecret(envWith({ TOKEN: "" }), "TOKEN"), null);
    assert.equal(envSecret(envWith({ TOKEN: "   " }), "TOKEN"), null);
  });

  // The case the lint rule flagged: a misconfigured binding that is an object
  // used to become the literal "[object Object]" and be sent as a credential.
  it("returns null for a non-string binding instead of [object Object]", () => {
    assert.equal(String({ nested: true }), "[object Object]"); // the trap
    assert.equal(envSecret(envWith({ TOKEN: { nested: true } }), "TOKEN"), null);
    assert.equal(envSecret(envWith({ TOKEN: ["a"] }), "TOKEN"), null);
    assert.equal(envSecret(envWith({ TOKEN: 12345 }), "TOKEN"), null);
  });
});

describe("requireEnvSecret", () => {
  it("returns a configured secret", () => {
    assert.equal(requireEnvSecret(envWith({ TOKEN: "abc123" }), "TOKEN"), "abc123");
  });

  it("names the missing binding so a misconfigured deploy says which one", () => {
    assert.throws(() => requireEnvSecret(envWith({}), "TELEGRAM_BOT_TOKEN"), /TELEGRAM_BOT_TOKEN is not configured/);
  });

  it("throws for a non-string binding rather than using it as a credential", () => {
    assert.throws(() => requireEnvSecret(envWith({ TOKEN: { oops: 1 } }), "TOKEN"), /TOKEN is not configured/);
  });
});
