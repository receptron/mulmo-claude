// Unit tests for pure helpers in server/agent/mcp-server.ts.
// The file is a stdio MCP bridge with module-level side effects
// (reads env, starts JSON-RPC), so we test the extractable logic
// by re-implementing the same algorithm in isolation. If the
// production implementation drifts, these tests act as a spec.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── fromPackage logic (#345) ──────────────────────────────────
//
// Combines `description` (one-liner) and `prompt` (detailed usage
// instructions) into a single MCP-description string. The MCP
// protocol has only `description` — no `prompt` field — so the
// prompt content must ride along.

function fromPackageDescription(description: string, prompt: string | undefined): string {
  const parts = [description];
  if (typeof prompt === "string" && prompt.length > 0) {
    parts.push(prompt);
  }
  return parts.join("\n\n");
}

describe("fromPackage description concatenation (#345)", () => {
  it("returns description alone when prompt is undefined", () => {
    assert.equal(fromPackageDescription("A tool", undefined), "A tool");
  });

  it("returns description alone when prompt is empty string", () => {
    assert.equal(fromPackageDescription("A tool", ""), "A tool");
  });

  it("joins description and prompt with double newline", () => {
    assert.equal(fromPackageDescription("A tool", "Use it like this."), "A tool\n\nUse it like this.");
  });

  it("handles multi-line prompt", () => {
    const result = fromPackageDescription("Short", "Line 1\nLine 2\nLine 3");
    assert.equal(result, "Short\n\nLine 1\nLine 2\nLine 3");
  });
});

// ── readSessionToken logic (#325) ─────────────────────────────
//
// Resolution order: MULMOCLAUDE_AUTH_TOKEN env var → file fallback.
// The real function reads WORKSPACE_PATHS.sessionToken which is
// module-level; here we test the algorithm in isolation.

function readSessionTokenAlgo(envValue: string | undefined, fileRead: () => string): string {
  if (typeof envValue === "string" && envValue.length > 0) return envValue;
  try {
    return fileRead().trim();
  } catch {
    return "";
  }
}

describe("readSessionToken resolution (#325)", () => {
  it("returns env var when present and non-empty", () => {
    assert.equal(
      readSessionTokenAlgo("env-token", () => "file-token"),
      "env-token",
    );
  });

  it("falls back to file read when env is undefined", () => {
    assert.equal(
      readSessionTokenAlgo(undefined, () => "file-token"),
      "file-token",
    );
  });

  it("falls back to file read when env is empty string", () => {
    assert.equal(
      readSessionTokenAlgo("", () => "file-token"),
      "file-token",
    );
  });

  it("trims whitespace from file read", () => {
    assert.equal(
      readSessionTokenAlgo(undefined, () => "  tok \n"),
      "tok",
    );
  });

  it("returns empty string when file read throws", () => {
    assert.equal(
      readSessionTokenAlgo(undefined, () => {
        throw new Error("ENOENT");
      }),
      "",
    );
  });

  it("env var wins even when file has different content", () => {
    assert.equal(
      readSessionTokenAlgo("primary", () => "secondary"),
      "primary",
    );
  });
});

// ── AUTH_HEADER construction (#325) ───────────────────────────

function buildAuthHeader(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

describe("AUTH_HEADER construction (#325)", () => {
  it("creates Authorization header when token is non-empty", () => {
    assert.deepEqual(buildAuthHeader("abc"), {
      Authorization: "Bearer abc",
    });
  });

  it("returns empty object when token is empty", () => {
    assert.deepEqual(buildAuthHeader(""), {});
  });
});
