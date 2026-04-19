import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../../server/system/logger/index.js";

describe("createLogger level filtering", () => {
  it("respects per-sink level thresholds when routing records", () => {
    const captured: { level: string; message: string }[] = [];
    // Build a logger that routes everything to an in-memory sink by
    // disabling the default console/file/telemetry sinks and attaching
    // a spy via a custom console-sink stdout override. Simplest way:
    // swap process.stdout.write for a spy and enable only console.
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    const lines: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      const logger = createLogger({
        sinks: {
          console: { enabled: true, level: "warn", format: "json" },
          file: {
            enabled: false,
            level: "debug",
            format: "json",
            dir: "/tmp",
            rotation: { kind: "daily", maxFiles: 1 },
          },
          telemetry: { enabled: false, level: "error", format: "json" },
        },
      });
      logger.debug("x", "should be dropped");
      logger.info("x", "should be dropped");
      logger.warn("x", "kept-warn");
      logger.error("x", "kept-error");
      for (const line of lines) {
        const parsed: { level: string; message: string } = JSON.parse(
          line.trim(),
        );
        captured.push(parsed);
      }
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    assert.equal(captured.length, 2);
    assert.equal(captured[0].message, "kept-warn");
    assert.equal(captured[1].message, "kept-error");
  });

  it("produces no output when all sinks are disabled", () => {
    // Capture writes to both streams so we can assert nothing is
    // emitted. Prior to this tightening the test only verified
    // "does not throw" — it would have passed even if the
    // all-disabled config leaked through to the console sink.
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    const recordWrite = (chunk: string | Uint8Array) => {
      captured.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    };
    process.stdout.write = recordWrite as typeof process.stdout.write;
    process.stderr.write = recordWrite as typeof process.stderr.write;
    try {
      const logger = createLogger({
        sinks: {
          console: { enabled: false, level: "debug", format: "text" },
          file: {
            enabled: false,
            level: "debug",
            format: "text",
            dir: "/tmp",
            rotation: { kind: "daily", maxFiles: 1 },
          },
          telemetry: { enabled: false, level: "error", format: "json" },
        },
      });
      logger.error("x", "nowhere");
      logger.warn("x", "nowhere");
      logger.info("x", "nowhere");
      logger.debug("x", "nowhere");
      assert.equal(captured.length, 0);
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
  });
});
