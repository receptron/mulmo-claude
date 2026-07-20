// Signature verification must fail closed when its secret binding is
// misconfigured.
//
// The verifiers take the secret as a plain string and use it directly as the
// HMAC key — they do not, and should not, second-guess whether it is a real
// credential. That makes the read the only place this can be caught. Reading
// `String(env.X)` produced a *predictable literal* for a non-string binding
// ("[object Object]"), and an HMAC keyed on a value an attacker can guess is
// not a signature check at all: they can compute a matching signature and be
// let in. Blank is the same story with an empty key.
//
// So these assert the read throws before any verification happens, per
// platform, rather than trusting one shared helper test to cover all three.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getPlatformByName } from "../src/platform.js";
import { PLATFORMS, type Env } from "../src/types.js";

// Importing the modules registers their plugins with the platform registry.
import "../src/webhooks/line.js";
import "../src/webhooks/messenger.js";
import "../src/webhooks/whatsapp.js";

const envWith = (values: Record<string, unknown>): Env => ({ RELAY: null, RELAY_TOKEN: "t", ...values }) as Env;

/** A request carrying a signature header — well-formed, so the only thing that
 *  can reject it is the secret read. */
function signedRequest(header: string): Request {
  return new Request("https://relay.example/webhook", {
    method: "POST",
    headers: { [header]: "sha256=deadbeef" },
    body: "{}",
  });
}

const CASES = [
  { platform: PLATFORMS.line, secretKey: "LINE_CHANNEL_SECRET", header: "x-line-signature" },
  { platform: PLATFORMS.messenger, secretKey: "MESSENGER_APP_SECRET", header: "x-hub-signature-256" },
  { platform: PLATFORMS.whatsapp, secretKey: "WHATSAPP_APP_SECRET", header: "x-hub-signature-256" },
] as const;

describe("webhook signature verification fails closed on a misconfigured secret", () => {
  for (const { platform, secretKey, header } of CASES) {
    // The case the lint rule surfaced: an object binding used to become the
    // literal "[object Object]" and be used as the HMAC key.
    it(`${platform}: rejects a non-string ${secretKey} instead of keying HMAC on "[object Object]"`, async () => {
      const plugin = getPlatformByName(platform);
      assert.ok(plugin, `${platform} plugin not registered`);
      await assert.rejects(
        () => Promise.resolve(plugin.handleWebhook(signedRequest(header), "{}", envWith({ [secretKey]: { oops: true } }))),
        new RegExp(`${secretKey} is not configured`),
      );
    });

    it(`${platform}: rejects an unset ${secretKey}`, async () => {
      const plugin = getPlatformByName(platform);
      assert.ok(plugin, `${platform} plugin not registered`);
      await assert.rejects(() => Promise.resolve(plugin.handleWebhook(signedRequest(header), "{}", envWith({}))), new RegExp(`${secretKey} is not configured`));
    });

    it(`${platform}: rejects a blank ${secretKey} rather than keying HMAC on ""`, async () => {
      const plugin = getPlatformByName(platform);
      assert.ok(plugin, `${platform} plugin not registered`);
      await assert.rejects(
        () => Promise.resolve(plugin.handleWebhook(signedRequest(header), "{}", envWith({ [secretKey]: "   " }))),
        new RegExp(`${secretKey} is not configured`),
      );
    });
  }
});
