// Reading a secret out of the Workers `Env` binding.
//
// `Env` carries `[key: string]: unknown` because platform secrets are accessed
// dynamically, so every `env.SOME_TOKEN` is `unknown` and the call sites reached
// for `String(...)` to get a string back. That works for a configured secret and
// lies about every other case: an unset binding becomes the literal "undefined",
// and a mistyped one (an object, from a bad `wrangler.toml`) becomes
// "[object Object]". Both are then used as a real credential — sent to the
// platform API, or fed to a signature check that fails for a reason the logs
// don't explain.
//
// These read a secret as what it is: a string, or absent.

import type { Env } from "../types.js";

/** The secret's value, or `null` when it is unset or not a string.
 *  Empty and whitespace-only count as unset — a blank secret is not a secret.
 *
 *  The value is trimmed, deliberately. Every binding read through here is an
 *  opaque platform credential — hex, base64url, or a bot token — and none can
 *  legitimately carry surrounding whitespace. What that whitespace does mean in
 *  practice is a trailing newline from `wrangler secret put < file` or a
 *  copy-paste, which otherwise travels into an `Authorization` header and comes
 *  back as a 401 that says nothing about why. A binding whose surrounding space
 *  is significant must not use these helpers. */
export function envSecret(env: Env, key: string): string | null {
  const value = env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The secret's value, or throw. Use where the handler cannot proceed without
 *  it — the message names the binding so a misconfigured deployment says which
 *  one, rather than failing later as a rejected signature or a 401. */
export function requireEnvSecret(env: Env, key: string): string {
  const value = envSecret(env, key);
  if (value === null) throw new Error(`${key} is not configured`);
  return value;
}
