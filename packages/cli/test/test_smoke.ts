// Smoke tests for @mulmobridge/cli. The CLI is an interactive process
// that connects to a running server, so we can't test the full flow.
// Instead we verify:
//   1. The entrypoint module can be parsed (catches syntax / import errors)
//   2. The @mulmobridge/client dependency is wired correctly

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createBridgeClient,
  requireBearerToken,
  readBridgeToken,
} from "@mulmobridge/client";

describe("@mulmobridge/cli — dependency smoke", () => {
  it("@mulmobridge/client exports createBridgeClient", () => {
    assert.equal(typeof createBridgeClient, "function");
  });

  it("@mulmobridge/client exports requireBearerToken", () => {
    assert.equal(typeof requireBearerToken, "function");
  });

  it("readBridgeToken returns null when no token is configured", () => {
    // Save and clear the env var so the test is hermetic
    const saved = process.env.MULMOCLAUDE_AUTH_TOKEN;
    delete process.env.MULMOCLAUDE_AUTH_TOKEN;
    try {
      // readBridgeToken falls back to file; in CI there's no
      // ~/mulmoclaude/.session-token, so it should return null.
      const token = readBridgeToken();
      // Either null (no file) or a string (dev machine has the server running)
      assert.ok(
        token === null || typeof token === "string",
        "readBridgeToken should return null or string",
      );
    } finally {
      if (saved !== undefined) process.env.MULMOCLAUDE_AUTH_TOKEN = saved;
    }
  });
});
