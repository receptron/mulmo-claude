// Tests for the shared env-scrape algorithm (#2487). The cases port the
// behaviours the two wrappers pin at their own level (`readBridgeEnvOptions`
// in @mulmobridge/client, `resolveRelayBridgeOptions` in the host) onto the
// shared function, plus the boundary semantics the wrappers rely on:
// precedence, claim-without-fallthrough, empty values, empty tails, and the
// allowKeys security filter.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { scanEnvOptions, snakeToLowerCamel } from "../src/index.ts";

const BRIDGE_PREFIXES = ["BRIDGE_", "SLACK_BRIDGE_"] as const;
const RELAY_LINE_PREFIXES = ["RELAY_", "RELAY_LINE_"] as const;

describe("snakeToLowerCamel", () => {
  it("single word lowercases", () => {
    assert.equal(snakeToLowerCamel("ROLE"), "role");
  });

  it("multi-segment becomes lowerCamel", () => {
    assert.equal(snakeToLowerCamel("DEFAULT_ROLE"), "defaultRole");
    assert.equal(snakeToLowerCamel("LONG_MULTI_PART_NAME"), "longMultiPartName");
  });

  it("adjacent underscores collapse to a single word break", () => {
    assert.equal(snakeToLowerCamel("MAX__PAGE___SIZE"), "maxPageSize");
  });

  it("leading and trailing underscores are ignored", () => {
    assert.equal(snakeToLowerCamel("_DEFAULT_ROLE_"), "defaultRole");
    assert.equal(snakeToLowerCamel("TRAILING_"), "trailing");
  });

  it("empty and all-underscore input yield the empty string", () => {
    assert.equal(snakeToLowerCamel(""), "");
    assert.equal(snakeToLowerCamel("___"), "");
  });
});

describe("scanEnvOptions — matching and casing (ported from readBridgeEnvOptions)", () => {
  it("scrapes the high-precedence prefix and strips it", () => {
    const out = scanEnvOptions({ SLACK_BRIDGE_DEFAULT_ROLE: "slack" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("scrapes the low-precedence (shared) prefix", () => {
    const out = scanEnvOptions({ BRIDGE_DEFAULT_ROLE: "general" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "general" });
  });

  it("converts UPPER_SNAKE tails to lowerCamel", () => {
    const out = scanEnvOptions(
      { SLACK_BRIDGE_MAX_PAGE_SIZE: "100", SLACK_BRIDGE_A: "x", SLACK_BRIDGE_LONG_MULTI_PART_NAME: "y" },
      { prefixes: BRIDGE_PREFIXES },
    );
    assert.deepEqual(out, { maxPageSize: "100", a: "x", longMultiPartName: "y" });
  });

  it("ignores names matching no prefix", () => {
    const out = scanEnvOptions(
      { SLACK_BOT_TOKEN: "xoxb-…", NODE_ENV: "test", PATH: "/usr/bin", TELEGRAM_BRIDGE_DEFAULT_ROLE: "coder" },
      { prefixes: BRIDGE_PREFIXES },
    );
    assert.deepEqual(out, {});
  });

  it("returns an empty object for an empty env", () => {
    assert.deepEqual(scanEnvOptions({}, { prefixes: BRIDGE_PREFIXES }), {});
  });

  it("does not coerce values (strings stay strings)", () => {
    const out = scanEnvOptions({ BRIDGE_PAGE_SIZE: "50", BRIDGE_ENABLED: "true" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { pageSize: "50", enabled: "true" });
  });
});

describe("scanEnvOptions — precedence", () => {
  it("later prefix wins when both set the same key", () => {
    const out = scanEnvOptions({ SLACK_BRIDGE_DEFAULT_ROLE: "slack", BRIDGE_DEFAULT_ROLE: "general" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("later prefix wins regardless of env iteration order", () => {
    const out = scanEnvOptions({ BRIDGE_DEFAULT_ROLE: "general", SLACK_BRIDGE_DEFAULT_ROLE: "slack" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("non-clashing keys from both prefixes merge", () => {
    const out = scanEnvOptions({ BRIDGE_DEFAULT_ROLE: "general", SLACK_BRIDGE_PAGE_SIZE: "10" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "general", pageSize: "10" });
  });

  it("within one prefix, the later env entry wins on a key clash", () => {
    const out = scanEnvOptions({ BRIDGE_FOO_BAR: "first", BRIDGE_FOO__BAR: "second" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { fooBar: "second" });
  });
});

describe("scanEnvOptions — claim semantics for overlapping prefixes", () => {
  it("a name matching the high prefix is claimed by it, not re-read via the low prefix", () => {
    // RELAY_LINE_DEFAULT_ROLE textually matches RELAY_ too; the claim must
    // yield { defaultRole }, never a blanket-bucket { lineDefaultRole }.
    const out = scanEnvOptions({ RELAY_LINE_DEFAULT_ROLE: "line-support" }, { prefixes: RELAY_LINE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "line-support" });
  });

  it("a high-prefix claim with an empty tail is dropped, never retried on the low prefix", () => {
    // "RELAY_LINE_" matches RELAY_LINE_ with an empty tail. Both original
    // implementations drop the var there — it must NOT fall through to the
    // RELAY_ branch and emit { line: "x" }.
    const out = scanEnvOptions({ RELAY_LINE_: "x" }, { prefixes: RELAY_LINE_PREFIXES });
    assert.deepEqual(out, {});
  });
});

describe("scanEnvOptions — dropped entries", () => {
  it("drops empty-string values so they don't shadow other matches", () => {
    const out = scanEnvOptions({ SLACK_BRIDGE_DEFAULT_ROLE: "", BRIDGE_DEFAULT_ROLE: "general" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "general" });
  });

  it("drops undefined values", () => {
    const out = scanEnvOptions({ BRIDGE_DEFAULT_ROLE: "general", BRIDGE_MISSING: undefined }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, { defaultRole: "general" });
  });

  it("drops names with an empty tail after the prefix", () => {
    const out = scanEnvOptions({ BRIDGE_: "nope", SLACK_BRIDGE_: "nope" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, {});
  });

  it("drops names whose tail camelises to the empty string", () => {
    const out = scanEnvOptions({ BRIDGE___: "nope" }, { prefixes: BRIDGE_PREFIXES });
    assert.deepEqual(out, {});
  });
});

describe("scanEnvOptions — allowKeys filter (ported from resolveRelayBridgeOptions)", () => {
  const allowKeys: ReadonlySet<string> = new Set(["defaultRole"]);

  it("does NOT emit keys outside the allowlist (RELAY_TOKEN / RELAY_URL stay out)", () => {
    const out = scanEnvOptions({ RELAY_TOKEN: "super-secret-bearer", RELAY_URL: "wss://example.com" }, { prefixes: RELAY_LINE_PREFIXES, allowKeys });
    assert.deepEqual(out, {});
  });

  it("does NOT emit per-platform keys outside the allowlist", () => {
    const out = scanEnvOptions({ RELAY_LINE_TOKEN: "ignored", RELAY_LINE_URL: "ignored" }, { prefixes: RELAY_LINE_PREFIXES, allowKeys });
    assert.deepEqual(out, {});
  });

  it("emits only the allowlisted key when secrets sit alongside it", () => {
    const out = scanEnvOptions({ RELAY_TOKEN: "secret", RELAY_DEFAULT_ROLE: "general" }, { prefixes: RELAY_LINE_PREFIXES, allowKeys });
    assert.deepEqual(out, { defaultRole: "general" });
  });

  it("an empty allowlist emits nothing", () => {
    const out = scanEnvOptions({ RELAY_DEFAULT_ROLE: "general" }, { prefixes: RELAY_LINE_PREFIXES, allowKeys: new Set<string>() });
    assert.deepEqual(out, {});
  });

  it("no allowKeys means every scanned key is emitted", () => {
    const out = scanEnvOptions({ RELAY_TOKEN: "visible-without-filter" }, { prefixes: RELAY_LINE_PREFIXES });
    assert.deepEqual(out, { token: "visible-without-filter" });
  });
});

describe("scanEnvOptions — single-prefix configuration (relay blank-platform shape)", () => {
  it("resolves only the one prefix", () => {
    const out = scanEnvOptions({ RELAY_DEFAULT_ROLE: "general", RELAY_LINE_DEFAULT_ROLE: "line-support" }, { prefixes: ["RELAY_"] });
    assert.deepEqual(out, { defaultRole: "general", lineDefaultRole: "line-support" });
  });
});
