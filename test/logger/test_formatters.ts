import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatJson, formatText } from "../../server/logger/formatters.js";
import type { LogRecord } from "../../server/logger/types.js";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: "2026-04-13T07:12:45.123Z",
    level: "info",
    prefix: "agent",
    message: "request received",
    ...overrides,
  };
}

describe("formatText", () => {
  it("formats a basic record with padded level and prefix", () => {
    assert.equal(
      formatText(record()),
      "2026-04-13T07:12:45.123Z INFO  [agent] request received",
    );
  });

  it("pads shorter levels (warn/info) and leaves 5-char levels alone", () => {
    assert.equal(
      formatText(record({ level: "warn" })),
      "2026-04-13T07:12:45.123Z WARN  [agent] request received",
    );
    assert.equal(
      formatText(record({ level: "error" })),
      "2026-04-13T07:12:45.123Z ERROR [agent] request received",
    );
    assert.equal(
      formatText(record({ level: "debug" })),
      "2026-04-13T07:12:45.123Z DEBUG [agent] request received",
    );
  });

  it("appends scalar data as k=v pairs", () => {
    const out = formatText(
      record({
        data: { sessionId: "abc123", code: 0, ok: true, nothing: null },
      }),
    );
    assert.ok(out.endsWith("sessionId=abc123 code=0 ok=true nothing=null"));
  });

  it("quotes string values containing whitespace", () => {
    const out = formatText(
      record({ data: { note: "with space", short: "plain" } }),
    );
    assert.ok(out.includes('note="with space"'));
    assert.ok(out.includes("short=plain"));
  });

  it("handles empty data object (no trailing space)", () => {
    const out = formatText(record({ data: {} }));
    assert.equal(
      out,
      "2026-04-13T07:12:45.123Z INFO  [agent] request received",
    );
  });

  it("serialises nested objects as JSON", () => {
    const out = formatText(record({ data: { meta: { a: 1, b: [2, 3] } } }));
    assert.ok(out.includes('meta={"a":1,"b":[2,3]}'));
  });
});

describe("formatJson", () => {
  it("emits a JSON object with required keys only", () => {
    const out = formatJson(record());
    assert.equal(
      out,
      '{"ts":"2026-04-13T07:12:45.123Z","level":"info","prefix":"agent","message":"request received"}',
    );
  });

  it("includes a data block when provided", () => {
    const out = formatJson(record({ data: { foo: "bar" } }));
    const parsed: { data?: Record<string, unknown> } = JSON.parse(out);
    assert.deepEqual(parsed.data, { foo: "bar" });
  });

  it("omits data block when undefined", () => {
    const out = formatJson(record());
    assert.ok(!out.includes('"data"'));
  });
});
