import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { logBackgroundError } from "../../server/utils/logBackgroundError.js";

// The helper returns a callback. We capture stderr (the logger's
// warn level target) so we can assert what lands without wiring
// dependency injection into the logger itself.
function captureStderr<T>(fn: () => T): { result: T; out: string } {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((c: string | Uint8Array) => {
    chunks.push(typeof c === "string" ? c : c.toString());
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = fn();
    return { result, out: chunks.join("") };
  } finally {
    process.stderr.write = originalWrite;
  }
}

describe("logBackgroundError", () => {
  it("returns a function that logs a warn with the given prefix", () => {
    const handler = logBackgroundError("journal");
    assert.equal(typeof handler, "function");
    const { out } = captureStderr(() => handler(new Error("boom")));
    assert.ok(out.includes("[journal]"), `missing prefix in: ${out}`);
    assert.ok(out.includes("unexpected error in background"));
    assert.ok(out.includes("boom"));
  });

  it("stringifies non-Error thrown values", () => {
    const handler = logBackgroundError("chat-index");
    const { out } = captureStderr(() => handler("plain string"));
    assert.ok(out.includes("plain string"));
  });

  it("does not throw back to the caller", () => {
    const handler = logBackgroundError("tool-trace");
    captureStderr(() => {
      assert.doesNotThrow(() => handler(new Error("x")));
    });
  });
});
