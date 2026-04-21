import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractClaudeErrorMessage, formatSpawnFailure } from "../../server/utils/spawn.js";

describe("extractClaudeErrorMessage", () => {
  it("returns null for empty/blank stdout", () => {
    assert.equal(extractClaudeErrorMessage(""), null);
    assert.equal(extractClaudeErrorMessage("   "), null);
  });

  it("returns null for non-JSON stdout", () => {
    assert.equal(extractClaudeErrorMessage("not json"), null);
  });

  it("returns null when is_error is not true", () => {
    assert.equal(extractClaudeErrorMessage(JSON.stringify({ result: "ok" })), null);
    assert.equal(extractClaudeErrorMessage(JSON.stringify({ is_error: false, errors: ["oops"] })), null);
  });

  it("extracts errors[] when present", () => {
    const msg = extractClaudeErrorMessage(
      JSON.stringify({
        is_error: true,
        errors: ["budget exceeded", "rate limited"],
      }),
    );
    assert.equal(msg, "budget exceeded; rate limited");
  });

  it("falls back to subtype: result", () => {
    const msg = extractClaudeErrorMessage(
      JSON.stringify({
        is_error: true,
        subtype: "error_max_budget_usd",
        result: "Budget limit reached",
      }),
    );
    assert.equal(msg, "error_max_budget_usd: Budget limit reached");
  });

  it("returns subtype alone when result is missing", () => {
    const msg = extractClaudeErrorMessage(JSON.stringify({ is_error: true, subtype: "auth_failure" }));
    assert.equal(msg, "auth_failure");
  });

  it("returns result alone when subtype is missing", () => {
    const msg = extractClaudeErrorMessage(JSON.stringify({ is_error: true, result: "Something went wrong" }));
    assert.equal(msg, "Something went wrong");
  });

  it("returns null when is_error but no usable fields", () => {
    assert.equal(extractClaudeErrorMessage(JSON.stringify({ is_error: true })), null);
  });
});

describe("formatSpawnFailure", () => {
  it("uses structured error from stdout when available", () => {
    const msg = formatSpawnFailure("[test]", 1, JSON.stringify({ is_error: true, errors: ["budget gone"] }), "");
    assert.match(msg, /\[test\].*budget gone/);
  });

  it("falls back to stderr when stdout has no structured error", () => {
    const msg = formatSpawnFailure("[test]", 1, "", "Permission denied");
    assert.match(msg, /\[test\].*Permission denied/);
  });

  it("falls back to stdout text when stderr is also empty", () => {
    const msg = formatSpawnFailure("[test]", 1, "raw output text", "");
    assert.match(msg, /\[test\].*raw output text/);
  });

  it("returns a fallback message when both stdout and stderr are empty", () => {
    const msg = formatSpawnFailure("[test]", 1, "", "");
    assert.match(msg, /\[test\].*no error output/);
  });

  it("includes the exit code", () => {
    const msg = formatSpawnFailure("[mod]", 42, "", "fail");
    assert.match(msg, /exited 42/);
  });

  it("truncates long stderr to 500 chars", () => {
    const longErr = "x".repeat(1000);
    const msg = formatSpawnFailure("[mod]", 1, "", longErr);
    assert.ok(msg.length < 600, "should truncate to ~500 chars");
  });

  it("prepends the given prefix", () => {
    const msg = formatSpawnFailure("[sources/classifier]", 1, "", "err");
    assert.ok(msg.startsWith("[sources/classifier]"));
  });
});
