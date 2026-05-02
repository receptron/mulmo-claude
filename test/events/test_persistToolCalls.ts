// Coverage for the opt-in `tool_call` jsonl persistence
// (PERSIST_TOOL_CALLS=1). See plans/feat-persist-tool-calls.md /
// issue #1096. Two angles:
//
//   1. Default (env flag off) — `pushSessionEvent` for a `tool_call`
//      MUST NOT touch the jsonl. The flag-off branch is the production
//      contract, so this test pins it.
//   2. Helper shape — `persistToolCallEvent` writes a single line in
//      the documented schema and appends rather than overwrites on
//      repeat calls. Unit-testing the helper directly avoids needing
//      a fresh process to flip `env.persistToolCalls` (frozen at
//      module load).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  __resetForTests,
  enqueueJsonlAppend,
  getOrCreateSession,
  initSessionStore,
  persistToolCallEvent,
  pushSessionEvent,
} from "../../server/events/session-store/index.ts";
import { EVENT_TYPES } from "../../src/types/events.ts";

const NOW = "2026-04-17T00:00:00.000Z";

beforeEach(__resetForTests);
afterEach(__resetForTests);

describe("PERSIST_TOOL_CALLS — default off", () => {
  it("does not write to the session jsonl when the flag is off", async () => {
    // env.persistToolCalls is false in the default test process,
    // so a tool_call event must not produce a jsonl write.
    const dir = await mkdtemp(path.join(tmpdir(), "persist-tool-calls-off-"));
    try {
      const jsonlPath = path.join(dir, "fake.jsonl");
      // Touch the file empty so we can compare later.
      await writeFile(jsonlPath, "");

      initSessionStore({ publish: () => {} });
      getOrCreateSession("chat-1", {
        roleId: "general",
        resultsFilePath: jsonlPath,
        startedAt: NOW,
        updatedAt: NOW,
      });

      pushSessionEvent("chat-1", {
        type: EVENT_TYPES.toolCall,
        toolUseId: "toolu_01abc",
        toolName: "presentMulmoScript",
        args: { title: "demo" },
      });

      // Allow any (un)scheduled async write a tick to land before we
      // assert. The flag-off branch never schedules one, but the
      // assertion has to be robust against `void someAsync().catch(...)`
      // if it's accidentally always-scheduled in a future change.
      await new Promise((resolve) => setImmediate(resolve));

      const contents = await readFile(jsonlPath, "utf8");
      assert.equal(contents, "", "jsonl must remain empty when PERSIST_TOOL_CALLS is off");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("persistToolCallEvent — schema", () => {
  it("appends one JSONL line per call, terminated by `\\n`", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "persist-tool-calls-helper-"));
    try {
      const jsonlPath = path.join(dir, "fake.jsonl");

      await persistToolCallEvent(jsonlPath, {
        type: EVENT_TYPES.toolCall,
        toolUseId: "toolu_01abc",
        toolName: "presentMulmoScript",
        args: { title: "demo" },
      });

      const contents = await readFile(jsonlPath, "utf8");
      assert.ok(contents.endsWith("\n"), "line must terminate with \\n so jsonl parsers can split");
      const parsed = JSON.parse(contents.trim()) as Record<string, unknown>;
      assert.equal(parsed.source, "agent");
      assert.equal(parsed.type, EVENT_TYPES.toolCall);
      assert.equal(parsed.toolUseId, "toolu_01abc");
      assert.equal(parsed.toolName, "presentMulmoScript");
      assert.deepEqual(parsed.args, { title: "demo" });
      assert.equal(typeof parsed.timestamp, "number", "timestamp is the wall-clock ms when persistence happened");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("appends rather than overwrites on subsequent calls", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "persist-tool-calls-append-"));
    try {
      const jsonlPath = path.join(dir, "fake.jsonl");

      await persistToolCallEvent(jsonlPath, { toolUseId: "u1", toolName: "a", args: {} });
      await persistToolCallEvent(jsonlPath, { toolUseId: "u2", toolName: "b", args: {} });

      const contents = await readFile(jsonlPath, "utf8");
      const lines = contents.trim().split("\n");
      assert.equal(lines.length, 2);
      const first = JSON.parse(lines[0]) as Record<string, unknown>;
      const second = JSON.parse(lines[1]) as Record<string, unknown>;
      assert.equal(first.toolUseId, "u1");
      assert.equal(second.toolUseId, "u2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("enqueueJsonlAppend — FIFO ordering across awaited / unawaited callers", () => {
  it("preserves the call order even when the first enqueue is unawaited and the second is awaited", async () => {
    // Reproduces the Codex review concern on PR #1101: if the first
    // append is fire-and-forget (`tool_call` from
    // `applyEventToSession`) and the second is awaited (`pushToolResult`),
    // the second can hit disk before the first under raw `appendFile`.
    // The fix routes both through `enqueueJsonlAppend`, whose internal
    // promise chain forces FIFO order.
    const dir = await mkdtemp(path.join(tmpdir(), "enqueue-fifo-"));
    try {
      const jsonlPath = path.join(dir, "fake.jsonl");
      await writeFile(jsonlPath, "");

      initSessionStore({ publish: () => {} });
      const session = getOrCreateSession("chat-fifo", {
        roleId: "general",
        resultsFilePath: jsonlPath,
        startedAt: NOW,
        updatedAt: NOW,
      });

      // First enqueue — DON'T await. Mirrors the `tool_call`
      // fire-and-forget path inside `applyEventToSession`.
      const callPromise = enqueueJsonlAppend(session, `${JSON.stringify({ source: "agent", type: "tool_call", toolUseId: "u1" })}\n`);
      // Second enqueue — await this one (mirrors `pushToolResult`).
      // Without the queue, this could append before the first one
      // resolves (the appendFile call had already been issued).
      await enqueueJsonlAppend(session, `${JSON.stringify({ source: "tool", type: "tool_result", toolUseId: "u1" })}\n`);
      // Drain the first enqueue so its rejection (if any) doesn't
      // become unhandled.
      await callPromise;

      const lines = (await readFile(jsonlPath, "utf8")).trim().split("\n");
      assert.equal(lines.length, 2);
      assert.equal((JSON.parse(lines[0]) as Record<string, unknown>).type, "tool_call", "tool_call must land first");
      assert.equal((JSON.parse(lines[1]) as Record<string, unknown>).type, "tool_result", "tool_result must land second");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
