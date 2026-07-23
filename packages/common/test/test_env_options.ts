// Tests for the shared env-var → options-bag scanner (#2487).
// The helper is pure (env is passed in), so every case builds the exact env
// dict it needs — no `process.env` mutation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanEnvOptions, snakeToLowerCamel } from "../src/env-options.js";

// The two real-world prefix sets the wrappers pass.
const BRIDGE_PREFIXES = ["SLACK_BRIDGE_", "BRIDGE_"] as const;
const RELAY_PREFIXES = ["RELAY_LINE_", "RELAY_"] as const;
const RELAY_ALLOW_KEYS: ReadonlySet<string> = new Set(["defaultRole"]);

describe("snakeToLowerCamel", () => {
  it("lowercases a single segment", () => {
    assert.equal(snakeToLowerCamel("DEFAULT"), "default");
  });

  it("camel-cases multi-segment tails", () => {
    assert.equal(snakeToLowerCamel("DEFAULT_ROLE"), "defaultRole");
    assert.equal(snakeToLowerCamel("LONG_MULTI_PART_NAME"), "longMultiPartName");
  });

  it("collapses adjacent underscores into one word break", () => {
    assert.equal(snakeToLowerCamel("MAX__PAGE___SIZE"), "maxPageSize");
  });

  it("ignores leading and trailing underscores", () => {
    assert.equal(snakeToLowerCamel("_DEFAULT_ROLE_"), "defaultRole");
  });

  it("keeps digits as-is", () => {
    assert.equal(snakeToLowerCamel("V2_API_KEY"), "v2ApiKey");
    assert.equal(snakeToLowerCamel("API_2_KEY"), "api2Key");
  });

  it("returns an empty string for word-free input", () => {
    assert.equal(snakeToLowerCamel(""), "");
    assert.equal(snakeToLowerCamel("_"), "");
    assert.equal(snakeToLowerCamel("___"), "");
  });

  it("leaves already-lowercase input alone apart from casing the tail", () => {
    assert.equal(snakeToLowerCamel("default_role"), "defaultRole");
  });
});

describe("scanEnvOptions — happy path", () => {
  it("strips the prefix and lowerCamels the tail", () => {
    const out = scanEnvOptions({ SLACK_BRIDGE_DEFAULT_ROLE: "slack" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("collects several keys at once and never coerces values", () => {
    const out = scanEnvOptions({ BRIDGE_PAGE_SIZE: "50", BRIDGE_ENABLED: "true", BRIDGE_A: "x" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { pageSize: "50", enabled: "true", a: "x" });
  });

  it("works with a single prefix (the blank-id form)", () => {
    // With no per-platform prefix, `RELAY_LINE_DEFAULT_ROLE` is just another
    // blanket name and camel-cases whole — the relay wrapper's allowlist is
    // what keeps it out of the bag (next case).
    const env = { RELAY_DEFAULT_ROLE: "general", RELAY_LINE_DEFAULT_ROLE: "line-support" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: ["RELAY_"] }), { defaultRole: "general", lineDefaultRole: "line-support" });
    assert.deepEqual(scanEnvOptions(env, { prefixes: ["RELAY_"], allowKeys: RELAY_ALLOW_KEYS }), { defaultRole: "general" });
  });
});

describe("scanEnvOptions — precedence", () => {
  it("an earlier prefix wins over a later one for the same key", () => {
    const env = { SLACK_BRIDGE_DEFAULT_ROLE: "slack", BRIDGE_DEFAULT_ROLE: "general" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: BRIDGE_PREFIXES }), { defaultRole: "slack" });
  });

  it("reversing the prefix order reverses the winner", () => {
    const env = { SLACK_BRIDGE_DEFAULT_ROLE: "slack", BRIDGE_DEFAULT_ROLE: "general" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: ["BRIDGE_", "SLACK_BRIDGE_"] }), { defaultRole: "general" });
  });

  it("the first matching prefix claims a name that both prefixes match", () => {
    // `RELAY_LINE_DEFAULT_ROLE` starts with both `RELAY_LINE_` and `RELAY_`.
    const env = { RELAY_LINE_DEFAULT_ROLE: "line-support", RELAY_DEFAULT_ROLE: "general" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: RELAY_PREFIXES }), { defaultRole: "line-support" });
  });

  it("keys set only by the lower-precedence prefix still come through", () => {
    const env = { RELAY_LINE_DEFAULT_ROLE: "line-support", RELAY_PAGE_SIZE: "10" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: RELAY_PREFIXES }), { defaultRole: "line-support", pageSize: "10" });
  });

  it("supports three prefixes, highest precedence first", () => {
    const env = { A_K: "a", B_K: "b", C_K: "c" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: ["A_", "B_", "C_"] }), { k: "a" });
    assert.deepEqual(scanEnvOptions(env, { prefixes: ["C_", "B_", "A_"] }), { k: "c" });
  });
});

describe("scanEnvOptions — allowKeys", () => {
  it("drops keys outside the allowlist", () => {
    const env = { RELAY_TOKEN: "super-secret-bearer", RELAY_URL: "wss://example.com" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: RELAY_PREFIXES, allowKeys: RELAY_ALLOW_KEYS }), {});
  });

  it("drops per-platform secrets too, not just the blanket form", () => {
    const env = { RELAY_LINE_TOKEN: "ignored", RELAY_LINE_URL: "ignored" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: RELAY_PREFIXES, allowKeys: RELAY_ALLOW_KEYS }), {});
  });

  it("keeps allowed keys alongside dropped ones", () => {
    const env = { RELAY_TOKEN: "secret", RELAY_DEFAULT_ROLE: "general" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: RELAY_PREFIXES, allowKeys: RELAY_ALLOW_KEYS }), { defaultRole: "general" });
  });

  it("omitting allowKeys lets every matching key through", () => {
    const env = { RELAY_TOKEN: "secret", RELAY_DEFAULT_ROLE: "general" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: RELAY_PREFIXES }), { token: "secret", defaultRole: "general" });
  });

  it("an empty allowlist drops everything", () => {
    const env = { RELAY_DEFAULT_ROLE: "general" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: RELAY_PREFIXES, allowKeys: new Set() }), {});
  });
});

describe("scanEnvOptions — empty / missing values", () => {
  it("returns an empty object for an empty env", () => {
    assert.deepEqual(scanEnvOptions({}, { prefixes: BRIDGE_PREFIXES }), {});
  });

  it("returns an empty object when nothing matches", () => {
    assert.deepEqual(scanEnvOptions({ PATH: "/usr/bin", HOME: "/Users/x" }, { prefixes: BRIDGE_PREFIXES }), {});
  });

  it("skips empty-string values so they cannot shadow a lower-precedence match", () => {
    const env = { SLACK_BRIDGE_DEFAULT_ROLE: "", BRIDGE_DEFAULT_ROLE: "general" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: BRIDGE_PREFIXES }), { defaultRole: "general" });
  });

  it("skips undefined values", () => {
    const env = { BRIDGE_DEFAULT_ROLE: undefined, BRIDGE_PAGE_SIZE: "10" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: BRIDGE_PREFIXES }), { pageSize: "10" });
  });

  it("an empty prefix list matches nothing", () => {
    assert.deepEqual(scanEnvOptions({ BRIDGE_DEFAULT_ROLE: "general" }, { prefixes: [] }), {});
  });
});

describe("scanEnvOptions — malformed names", () => {
  it("ignores a name that is exactly the prefix (empty tail)", () => {
    assert.deepEqual(scanEnvOptions({ BRIDGE_: "x" }, { prefixes: BRIDGE_PREFIXES }), {});
    assert.deepEqual(scanEnvOptions({ SLACK_BRIDGE_: "x" }, { prefixes: BRIDGE_PREFIXES }), {});
  });

  it("does not retry a lower-precedence prefix after an empty tail", () => {
    // `RELAY_LINE_` matches the specific prefix with an empty tail. It also
    // starts with `RELAY_` (tail `LINE_` → key `line`), but the match is
    // claimed and rejected by the first prefix — the blanket form never sees it.
    assert.deepEqual(scanEnvOptions({ RELAY_LINE_: "x" }, { prefixes: RELAY_PREFIXES }), {});
  });

  it("ignores a tail made only of underscores (no word characters)", () => {
    assert.deepEqual(scanEnvOptions({ BRIDGE___: "x" }, { prefixes: BRIDGE_PREFIXES }), {});
  });

  it("normalises repeated and trailing underscores inside a tail", () => {
    const env = { BRIDGE_MAX__PAGE_SIZE_: "100" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: BRIDGE_PREFIXES }), { maxPageSize: "100" });
  });

  it("does not match a dashed prefix form (dashes are not shell-settable)", () => {
    const env = { "GOOGLE-CHAT_BRIDGE_DEFAULT_ROLE": "bogus", GOOGLE_CHAT_BRIDGE_DEFAULT_ROLE: "correct" };
    assert.deepEqual(scanEnvOptions(env, { prefixes: ["GOOGLE_CHAT_BRIDGE_", "BRIDGE_"] }), { defaultRole: "correct" });
  });

  it("matches on the prefix only, not on a mid-name occurrence", () => {
    assert.deepEqual(scanEnvOptions({ MY_BRIDGE_DEFAULT_ROLE: "nope" }, { prefixes: ["BRIDGE_"] }), {});
  });

  it("does not read inherited Object.prototype keys as env entries", () => {
    const env: Record<string, string | undefined> = Object.create({ BRIDGE_DEFAULT_ROLE: "inherited" });
    env.BRIDGE_PAGE_SIZE = "10";
    assert.deepEqual(scanEnvOptions(env, { prefixes: BRIDGE_PREFIXES }), { pageSize: "10" });
  });
});
