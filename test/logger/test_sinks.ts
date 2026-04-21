import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { createFileSink } from "../../server/system/logger/sinks.js";
import type { LogRecord } from "../../server/system/logger/types.js";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    time: "2026-04-13T07:12:45.123Z",
    level: "info",
    prefix: "agent",
    message: "hello",
    ...overrides,
  };
}

describe("createFileSink", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "log-sink-"));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes JSON records to the current day's file", async () => {
    const sink = createFileSink(
      {
        enabled: true,
        level: "debug",
        format: "json",
        dir,
        rotation: { kind: "daily", maxFiles: 7 },
      },
      { now: () => new Date("2026-04-13T10:00:00Z") },
    );
    sink.write(record({ message: "first" }));
    sink.write(record({ message: "second" }));
    await sink.flush?.();
    const contents = await readFile(path.join(dir, "server-2026-04-13.log"), "utf-8");
    const lines = contents.trim().split("\n");
    assert.equal(lines.length, 2);
    const parsed0: { message: string } = JSON.parse(lines[0]);
    const parsed1: { message: string } = JSON.parse(lines[1]);
    assert.equal(parsed0.message, "first");
    assert.equal(parsed1.message, "second");
  });

  it("rotates to a new file when the UTC day changes", async () => {
    const rotDir = await mkdtemp(path.join(os.tmpdir(), "log-rot-"));
    let fake = new Date("2026-05-01T10:00:00Z");
    const sink = createFileSink(
      {
        enabled: true,
        level: "debug",
        format: "text",
        dir: rotDir,
        rotation: { kind: "daily", maxFiles: 7 },
      },
      { now: () => fake },
    );
    sink.write(record({ message: "day1" }));
    await sink.flush?.();
    fake = new Date("2026-05-02T00:05:00Z");
    sink.write(record({ message: "day2" }));
    await sink.flush?.();
    const files = await readdir(rotDir);
    assert.ok(files.includes("server-2026-05-01.log"));
    assert.ok(files.includes("server-2026-05-02.log"));
    const day1 = await readFile(path.join(rotDir, "server-2026-05-01.log"), "utf-8");
    const day2 = await readFile(path.join(rotDir, "server-2026-05-02.log"), "utf-8");
    assert.ok(day1.includes("day1"));
    assert.ok(day2.includes("day2"));
    await rm(rotDir, { recursive: true, force: true });
  });

  it("enforces maxFiles retention on rotation", async () => {
    const retDir = await mkdtemp(path.join(os.tmpdir(), "log-ret-"));
    // Pre-create 3 old files
    await writeFile(path.join(retDir, "server-2026-01-01.log"), "a");
    await writeFile(path.join(retDir, "server-2026-01-02.log"), "b");
    await writeFile(path.join(retDir, "server-2026-01-03.log"), "c");
    const sink = createFileSink(
      {
        enabled: true,
        level: "debug",
        format: "text",
        dir: retDir,
        rotation: { kind: "daily", maxFiles: 2 },
      },
      { now: () => new Date("2026-01-04T00:00:00Z") },
    );
    sink.write(record({ message: "fresh" }));
    await sink.flush?.();
    const files = (await readdir(retDir)).sort();
    // maxFiles=2 keeps EXACTLY the 2 newest log files (including
    // the fresh one). Asserting just "includes newest" and "not
    // oldest" previously could pass even when retention left an
    // extra middle log behind — tighten to count + exact set.
    const logFiles = files.filter((file) => file.startsWith("server-"));
    assert.equal(logFiles.length, 2);
    assert.ok(files.includes("server-2026-01-04.log"));
    assert.ok(files.includes("server-2026-01-03.log"));
    assert.ok(!files.includes("server-2026-01-02.log"));
    assert.ok(!files.includes("server-2026-01-01.log"));
    await rm(retDir, { recursive: true, force: true });
  });
});
