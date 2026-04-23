// Tests for the bridge env-var → options-bag scraper.
// The helper is pure (env is passed in), so every test constructs
// the exact env dict it needs — no process.env mutation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readBridgeEnvOptions } from "../src/options.js";

describe("readBridgeEnvOptions", () => {
  it("scrapes <TRANSPORT>_BRIDGE_* and strips the prefix", () => {
    const out = readBridgeEnvOptions("slack", {
      SLACK_BRIDGE_DEFAULT_ROLE: "slack",
    });
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("scrapes the shared BRIDGE_* fallback", () => {
    const out = readBridgeEnvOptions("slack", {
      BRIDGE_DEFAULT_ROLE: "general",
    });
    assert.deepEqual(out, { defaultRole: "general" });
  });

  it("transport-specific wins over shared when both set the same key", () => {
    const out = readBridgeEnvOptions("slack", {
      SLACK_BRIDGE_DEFAULT_ROLE: "slack",
      BRIDGE_DEFAULT_ROLE: "general",
    });
    assert.deepEqual(out, { defaultRole: "slack" });
  });

  it("converts UPPER_SNAKE tails to lowerCamel", () => {
    const out = readBridgeEnvOptions("slack", {
      SLACK_BRIDGE_MAX_PAGE_SIZE: "100",
      SLACK_BRIDGE_A: "x",
      SLACK_BRIDGE_LONG_MULTI_PART_NAME: "y",
    });
    assert.deepEqual(out, {
      maxPageSize: "100",
      a: "x",
      longMultiPartName: "y",
    });
  });

  it("ignores internal env vars that lack the _BRIDGE_ marker", () => {
    const out = readBridgeEnvOptions("slack", {
      SLACK_BOT_TOKEN: "xoxb-…",
      SLACK_APP_TOKEN: "xapp-…",
      SLACK_ALLOWED_CHANNELS: "C1,C2",
      SLACK_SESSION_GRANULARITY: "thread",
    });
    assert.deepEqual(out, {});
  });

  it("ignores other bridges' env vars when scraping for one transport", () => {
    const out = readBridgeEnvOptions("slack", {
      TELEGRAM_BRIDGE_DEFAULT_ROLE: "coder",
      MASTODON_BRIDGE_FOO: "bar",
    });
    assert.deepEqual(out, {});
  });

  it("drops empty-string values so they don't shadow other matches", () => {
    const out = readBridgeEnvOptions("slack", {
      SLACK_BRIDGE_DEFAULT_ROLE: "",
      BRIDGE_DEFAULT_ROLE: "general",
    });
    assert.deepEqual(out, { defaultRole: "general" });
  });

  it("ignores vars with an empty tail after the prefix", () => {
    const out = readBridgeEnvOptions("slack", {
      SLACK_BRIDGE_: "nope",
      BRIDGE_: "nope",
    });
    assert.deepEqual(out, {});
  });

  it("normalises transportId casing (lower-case input → upper-case prefix)", () => {
    const out = readBridgeEnvOptions("slack", {
      SLACK_BRIDGE_FOO: "bar",
    });
    assert.deepEqual(out, { foo: "bar" });
  });

  it("leaves other-language content as-is (strings only, no coercion)", () => {
    const out = readBridgeEnvOptions("telegram", {
      TELEGRAM_BRIDGE_PAGE_SIZE: "50",
      TELEGRAM_BRIDGE_ENABLED: "true",
    });
    // No int / bool coercion — host app parses how it wants.
    assert.deepEqual(out, { pageSize: "50", enabled: "true" });
  });

  it("returns an empty object when no matches", () => {
    const out = readBridgeEnvOptions("slack", { PATH: "/usr/bin", HOME: "/Users/x" });
    assert.deepEqual(out, {});
  });

  it("tolerates undefined values in the env dict", () => {
    const out = readBridgeEnvOptions("slack", {
      SLACK_BRIDGE_DEFAULT_ROLE: "slack",
      SLACK_BRIDGE_MISSING: undefined,
    });
    assert.deepEqual(out, { defaultRole: "slack" });
  });
});
