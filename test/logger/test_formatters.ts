import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatJson, formatText, formatTextColor } from "../../server/system/logger/formatters.js";
import type { LogRecord } from "../../server/system/logger/types.js";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    time: "2026-04-13T07:12:45.123Z",
    level: "info",
    prefix: "agent",
    message: "request received",
    ...overrides,
  };
}

describe("formatText", () => {
  it("formats a basic record with padded level and prefix", () => {
    assert.equal(formatText(record()), "2026-04-13T07:12:45.123Z INFO  [agent] request received");
  });

  it("pads shorter levels (warn/info) and leaves 5-char levels alone", () => {
    assert.equal(formatText(record({ level: "warn" })), "2026-04-13T07:12:45.123Z WARN  [agent] request received");
    assert.equal(formatText(record({ level: "error" })), "2026-04-13T07:12:45.123Z ERROR [agent] request received");
    assert.equal(formatText(record({ level: "debug" })), "2026-04-13T07:12:45.123Z DEBUG [agent] request received");
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
    const out = formatText(record({ data: { note: "with space", short: "plain" } }));
    assert.ok(out.includes('note="with space"'));
    assert.ok(out.includes("short=plain"));
  });

  it("handles empty data object (no trailing space)", () => {
    const out = formatText(record({ data: {} }));
    assert.equal(out, "2026-04-13T07:12:45.123Z INFO  [agent] request received");
  });

  it("serialises nested objects as JSON", () => {
    const out = formatText(record({ data: { meta: { a: 1, b: [2, 3] } } }));
    assert.ok(out.includes('meta={"a":1,"b":[2,3]}'));
  });
});

describe("formatTextColor", () => {
  // Build the ANSI patterns from String.fromCharCode so the lint rule
  // `no-control-regex` doesn't trip on a literal ESC byte in the source.
  const ESC = String.fromCharCode(27);
  const ANY_ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
  const FIRST_CODE = new RegExp(`${ESC}\\[([0-9;]+)m`);

  it("wraps the entire line for error and warn (whole-row colour)", () => {
    for (const level of ["error", "warn"] as const) {
      const colored = formatTextColor(record({ level }));
      assert.ok(colored.startsWith(ESC + "["), `expected ${level} line to start with an ANSI escape`);
      assert.ok(colored.endsWith(ESC + "[0m"), `expected ${level} line to end with the ANSI reset`);
      // Exactly one open escape + the closing reset — no nested wraps
      // around the level word.
      const escapeCount = (colored.match(ANY_ANSI) ?? []).length;
      assert.equal(escapeCount, 2, `expected exactly two SGR codes for ${level}, got ${escapeCount}`);
      // Stripping ANSI recovers the plain output exactly.
      assert.equal(colored.replaceAll(ANY_ANSI, ""), formatText(record({ level })));
    }
  });

  it("colours only the level word for info and debug (chatty levels stay quiet)", () => {
    for (const level of ["info", "debug"] as const) {
      const colored = formatTextColor(record({ level }));
      // Should NOT start with an escape — the timestamp leads.
      assert.ok(!colored.startsWith(ESC + "["), `expected ${level} line to start with the timestamp, not ANSI`);
      // Exactly one wrapped slot: open + reset around the level word.
      const escapeCount = (colored.match(ANY_ANSI) ?? []).length;
      assert.equal(escapeCount, 2, `expected exactly one wrapped slot for ${level}`);
      assert.equal(colored.replaceAll(ANY_ANSI, ""), formatText(record({ level })));
    }
  });

  it("uses distinct colour codes per level (sanity check)", () => {
    const seen = new Set<string>();
    for (const level of ["error", "warn", "info", "debug"] as const) {
      const out = formatTextColor(record({ level }));
      const match = FIRST_CODE.exec(out);
      assert.ok(match, `expected colour escape for level ${level}`);
      seen.add(match[1] ?? "");
    }
    assert.equal(seen.size, 4, "every level should map to a distinct ANSI code");
  });
});

describe("formatJson", () => {
  it("emits a JSON object with required keys only", () => {
    const out = formatJson(record());
    assert.equal(out, '{"time":"2026-04-13T07:12:45.123Z","level":"info","prefix":"agent","message":"request received"}');
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
