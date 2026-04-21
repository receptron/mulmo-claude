import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendLogEntry, queryLog, logFilePathFor, type LogDeps } from "../src/log.ts";
import type { TaskLogEntry } from "../src/types.ts";

function inMemoryLogDeps(): LogDeps & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    appendFile: async (p, content) => {
      store.set(p, (store.get(p) ?? "") + content);
    },
    readFile: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
    exists: (p) => store.has(p),
    ensureDir: async () => {},
  };
}

function makeEntry(overrides: Partial<TaskLogEntry> = {}): TaskLogEntry {
  return {
    taskId: "t1",
    taskName: "Test Task",
    scheduledFor: "2026-04-17T08:00:00.000Z",
    startedAt: "2026-04-17T08:00:01.000Z",
    completedAt: "2026-04-17T08:00:05.000Z",
    result: "success",
    durationMs: 4000,
    trigger: "scheduled",
    ...overrides,
  };
}

describe("logFilePathFor", () => {
  it("builds YYYY-MM-DD.jsonl from a Date", () => {
    const d = new Date("2026-04-17T12:00:00Z");
    assert.equal(logFilePathFor("/logs", d), "/logs/2026-04-17.jsonl");
  });
});

describe("appendLogEntry", () => {
  it("appends a JSON line to the file", async () => {
    const deps = inMemoryLogDeps();
    await appendLogEntry("/logs", makeEntry(), deps);
    const raw = deps.store.get("/logs/2026-04-17.jsonl")!;
    const parsed = JSON.parse(raw.trim());
    assert.equal(parsed.taskId, "t1");
    assert.equal(parsed.result, "success");
  });

  it("appends multiple entries as separate lines", async () => {
    const deps = inMemoryLogDeps();
    await appendLogEntry("/logs", makeEntry({ taskId: "a" }), deps);
    await appendLogEntry("/logs", makeEntry({ taskId: "b" }), deps);
    const lines = deps.store.get("/logs/2026-04-17.jsonl")!.trim().split("\n");
    assert.equal(lines.length, 2);
  });
});

describe("queryLog", () => {
  it("returns entries newest first", async () => {
    const deps = inMemoryLogDeps();
    await appendLogEntry("/logs", makeEntry({ taskId: "old", startedAt: "2026-04-17T06:00:00.000Z" }), deps);
    await appendLogEntry("/logs", makeEntry({ taskId: "new", startedAt: "2026-04-17T09:00:00.000Z" }), deps);
    const testDate = new Date("2026-04-17T12:00:00Z");
    const entries = await queryLog("/logs", { date: testDate }, deps);
    assert.equal(entries[0].taskId, "new");
    assert.equal(entries[1].taskId, "old");
  });

  it("filters by taskId", async () => {
    const deps = inMemoryLogDeps();
    await appendLogEntry("/logs", makeEntry({ taskId: "a" }), deps);
    await appendLogEntry("/logs", makeEntry({ taskId: "b" }), deps);
    const testDate = new Date("2026-04-17T12:00:00Z");
    const entries = await queryLog("/logs", { taskId: "a", date: testDate }, deps);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].taskId, "a");
  });

  it("respects limit", async () => {
    const deps = inMemoryLogDeps();
    for (let i = 0; i < 10; i++) {
      await appendLogEntry("/logs", makeEntry({ taskId: `t${i}` }), deps);
    }
    const testDate = new Date("2026-04-17T12:00:00Z");
    const entries = await queryLog("/logs", { limit: 3, date: testDate }, deps);
    assert.equal(entries.length, 3);
  });

  it("filters by since timestamp", async () => {
    const deps = inMemoryLogDeps();
    await appendLogEntry("/logs", makeEntry({ taskId: "old", startedAt: "2026-04-17T06:00:00.000Z" }), deps);
    await appendLogEntry("/logs", makeEntry({ taskId: "new", startedAt: "2026-04-17T09:00:00.000Z" }), deps);
    const testDate = new Date("2026-04-17T12:00:00Z");
    const entries = await queryLog("/logs", { since: "2026-04-17T08:00:00.000Z", date: testDate }, deps);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].taskId, "new");
  });

  it("returns empty array when no log file exists", async () => {
    const deps = inMemoryLogDeps();
    const entries = await queryLog("/logs", { date: new Date("2099-01-01") }, deps);
    assert.deepEqual(entries, []);
  });
});
