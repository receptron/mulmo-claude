// Unit tests for the per-bridge default-role resolver.
// Covers the absence / unknown-role / happy-path branches without
// spinning up the relay or a real role registry — getRole is a
// trivial mock.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDefaultRole } from "../src/relay.js";
import type { Logger, Role } from "../src/types.js";

const KNOWN_ROLES: Role[] = [
  { id: "general", name: "General", icon: "chat", prompt: "", availablePlugins: [] },
  { id: "slack", name: "Slack", icon: "tag", prompt: "", availablePlugins: [] },
];

// `getRole` in the host app silently returns the first built-in
// when the id doesn't match — the resolver has to detect that
// case by comparing the returned `.id` back to the input.
function makeGetRole(roles: Role[]): (roleId: string) => Role {
  return (roleId: string) => roles.find((role) => role.id === roleId) ?? roles[0];
}

interface Captured {
  level: "error" | "warn" | "info" | "debug";
  msg: string;
  data?: Record<string, unknown>;
}

function makeLogger(): { logger: Logger; captured: Captured[] } {
  const captured: Captured[] = [];
  const record = (level: Captured["level"]) => (_prefix: string, msg: string, data?: Record<string, unknown>) => {
    captured.push({ level, msg, data });
  };
  return {
    captured,
    logger: {
      error: record("error"),
      warn: record("warn"),
      info: record("info"),
      debug: record("debug"),
    },
  };
}

describe("resolveDefaultRole", () => {
  it("returns the host-app fallback when bridgeOptions is undefined", () => {
    const { logger } = makeLogger();
    const out = resolveDefaultRole(undefined, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "general");
  });

  it("returns the fallback when bridgeOptions is empty", () => {
    const { logger } = makeLogger();
    const out = resolveDefaultRole({}, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "general");
  });

  it("uses bridgeOptions.defaultRole when it names a known role", () => {
    const { logger, captured } = makeLogger();
    const out = resolveDefaultRole({ defaultRole: "slack" }, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "slack");
    // Happy path must not log a warn — noise would make the actual
    // typo case harder to spot in logs.
    assert.equal(captured.filter((entry) => entry.level === "warn").length, 0);
  });

  it("falls back + warn-logs when defaultRole names an unknown role", () => {
    const { logger, captured } = makeLogger();
    const out = resolveDefaultRole({ defaultRole: "not-a-role" }, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "general");
    const warns = captured.filter((entry) => entry.level === "warn");
    assert.equal(warns.length, 1);
    assert.equal(warns[0].data?.requested, "not-a-role");
    assert.equal(warns[0].data?.transportId, "slack");
    assert.equal(warns[0].data?.fallback, "general");
  });

  it("ignores non-string defaultRole values without throwing", () => {
    const { logger } = makeLogger();
    // Hostile / malformed values the bridge client might send.
    assert.equal(resolveDefaultRole({ defaultRole: 123 as unknown }, makeGetRole(KNOWN_ROLES), "general", logger, "slack"), "general");
    assert.equal(resolveDefaultRole({ defaultRole: null as unknown }, makeGetRole(KNOWN_ROLES), "general", logger, "slack"), "general");
    assert.equal(resolveDefaultRole({ defaultRole: {} as unknown }, makeGetRole(KNOWN_ROLES), "general", logger, "slack"), "general");
  });

  it("treats empty-string defaultRole as absence (no warn)", () => {
    const { logger, captured } = makeLogger();
    const out = resolveDefaultRole({ defaultRole: "" }, makeGetRole(KNOWN_ROLES), "general", logger, "slack");
    assert.equal(out, "general");
    // Empty string is "nothing was set", not "user made a typo" —
    // no warn log expected.
    assert.equal(captured.filter((entry) => entry.level === "warn").length, 0);
  });
});
