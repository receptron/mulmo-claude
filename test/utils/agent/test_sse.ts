// Unit tests for the pure SSE parsing helpers extracted from
// `src/App.vue#sendMessage`. See plans/refactor-vue-cognitive-complexity.md
// and issue #175.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSSEChunk, decodeSSELine } from "../../../src/utils/agent/sse.js";

describe("decodeSSELine — happy path", () => {
  it("decodes a status event", () => {
    const line = `data: ${JSON.stringify({ type: "status", message: "Hi" })}`;
    assert.deepEqual(decodeSSELine(line), { type: "status", message: "Hi" });
  });

  it("decodes a text event", () => {
    const line = `data: ${JSON.stringify({ type: "text", message: "ok" })}`;
    assert.deepEqual(decodeSSELine(line), { type: "text", message: "ok" });
  });

  it("decodes a tool_call event with complex args", () => {
    const event = {
      type: "tool_call",
      toolUseId: "use-1",
      toolName: "doStuff",
      args: { nested: { x: 1 }, list: [1, "two"] },
    };
    const line = `data: ${JSON.stringify(event)}`;
    assert.deepEqual(decodeSSELine(line), event);
  });

  it("decodes every known event type", () => {
    const samples = [
      { type: "tool_call", toolUseId: "u", toolName: "t", args: {} },
      { type: "tool_call_result", toolUseId: "u", content: "c" },
      { type: "status", message: "m" },
      { type: "switch_role", roleId: "r" },
      { type: "text", message: "m" },
      { type: "tool_result", result: { uuid: "x" } },
      { type: "roles_updated" },
      { type: "error", message: "oops" },
    ];
    for (const sample of samples) {
      const line = `data: ${JSON.stringify(sample)}`;
      assert.ok(decodeSSELine(line), `${sample.type} should decode`);
    }
  });
});

describe("decodeSSELine — rejects noise", () => {
  it("returns null for a non-data line (SSE comment)", () => {
    assert.equal(decodeSSELine(":keepalive"), null);
  });

  it("returns null for a blank line", () => {
    assert.equal(decodeSSELine(""), null);
  });

  it("returns null for an `event:` SSE field without `data: ` prefix", () => {
    assert.equal(decodeSSELine("event: status"), null);
  });

  it("returns null for `data:` without the required space", () => {
    // We intentionally match `data: ` (trailing space). `data:foo`
    // is spec-legal SSE but our server never emits it, so treating
    // it as noise is simpler than accepting both forms.
    assert.equal(decodeSSELine('data:{"type":"status"}'), null);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(decodeSSELine("data: { broken"), null);
  });

  it("returns null for non-object JSON payloads", () => {
    assert.equal(decodeSSELine("data: 42"), null);
    assert.equal(decodeSSELine("data: null"), null);
    assert.equal(decodeSSELine("data: [1,2,3]"), null);
    assert.equal(decodeSSELine('data: "just a string"'), null);
  });

  it("returns null when `type` is missing", () => {
    assert.equal(decodeSSELine('data: {"message":"hi"}'), null);
  });

  it("returns null for unknown `type` (future event type)", () => {
    assert.equal(
      decodeSSELine('data: {"type":"mystery","message":"new"}'),
      null,
    );
  });
});

describe("parseSSEChunk — buffer management", () => {
  it("returns empty events and empty remaining for empty input", () => {
    assert.deepEqual(parseSSEChunk("", ""), { events: [], remaining: "" });
  });

  it("returns one event when the chunk ends exactly on a newline", () => {
    const chunk = `data: ${JSON.stringify({ type: "status", message: "a" })}\n`;
    const out = parseSSEChunk("", chunk);
    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].type, "status");
    assert.equal(out.remaining, "");
  });

  it("holds a partial trailing line in `remaining`", () => {
    const chunk = `data: ${JSON.stringify({ type: "status", message: "a" })}\ndata: {"type":"text","mess`;
    const out = parseSSEChunk("", chunk);
    assert.equal(out.events.length, 1);
    assert.equal(out.remaining, 'data: {"type":"text","mess');
  });

  it("completes a message split across two chunks", () => {
    const first = parseSSEChunk("", 'data: {"type":"text","mess');
    assert.equal(first.events.length, 0);
    assert.equal(first.remaining, 'data: {"type":"text","mess');
    const second = parseSSEChunk(first.remaining, 'age":"ok"}\n');
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0].type, "text");
    assert.equal(second.remaining, "");
  });

  it("returns multiple events in a single chunk", () => {
    const chunk = [
      `data: ${JSON.stringify({ type: "status", message: "a" })}`,
      `data: ${JSON.stringify({ type: "text", message: "b" })}`,
      `data: ${JSON.stringify({ type: "status", message: "c" })}`,
      "",
    ].join("\n");
    const out = parseSSEChunk("", chunk);
    assert.equal(out.events.length, 3);
    assert.equal(out.events[0].type, "status");
    assert.equal(out.events[1].type, "text");
    assert.equal(out.events[2].type, "status");
  });

  it("preserves events before a malformed line and skips the malformed one", () => {
    const chunk = [
      `data: ${JSON.stringify({ type: "status", message: "ok" })}`,
      "data: { not json",
      `data: ${JSON.stringify({ type: "text", message: "next" })}`,
      "",
    ].join("\n");
    const out = parseSSEChunk("", chunk);
    // 2 valid events, the malformed one is dropped.
    assert.equal(out.events.length, 2);
    assert.equal(out.events[0].type, "status");
    assert.equal(out.events[1].type, "text");
  });

  it("passes keep-alive comments through without emitting events", () => {
    const chunk =
      ":ping\n" +
      `data: ${JSON.stringify({ type: "status", message: "ok" })}\n`;
    const out = parseSSEChunk("", chunk);
    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].type, "status");
  });

  it("handles a series of small chunks that together form two events", () => {
    // Byte-by-byte delivery is realistic with Server-Sent-Events
    // over flaky networks. The decoder state must survive every
    // sub-newline split.
    const stream = [
      `data: ${JSON.stringify({ type: "status", message: "a" })}\n`,
      `data: ${JSON.stringify({ type: "text", message: "b" })}\n`,
    ].join("");
    let buffer = "";
    const seen: string[] = [];
    // Feed 7 chars at a time
    for (let i = 0; i < stream.length; i += 7) {
      const slice = stream.slice(i, i + 7);
      const parsed = parseSSEChunk(buffer, slice);
      buffer = parsed.remaining;
      for (const event of parsed.events) seen.push(event.type);
    }
    assert.deepEqual(seen, ["status", "text"]);
    assert.equal(buffer, "");
  });
});
