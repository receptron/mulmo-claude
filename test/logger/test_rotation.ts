import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { dailyFileName, enforceMaxFiles, listLogFiles } from "../../server/system/logger/rotation.js";

describe("dailyFileName", () => {
  it("formats a UTC date into server-YYYY-MM-DD.log", () => {
    assert.equal(dailyFileName(new Date("2026-04-13T07:12:45.123Z")), "server-2026-04-13.log");
  });

  it("zero-pads single-digit months and days", () => {
    assert.equal(dailyFileName(new Date("2026-01-02T00:00:00Z")), "server-2026-01-02.log");
  });
});

describe("listLogFiles / enforceMaxFiles", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "log-rot-"));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty when dir doesn't exist", async () => {
    const files = await listLogFiles(path.join(dir, "nope"));
    assert.deepEqual(files, []);
  });

  it("lists only log-named files, newest first", async () => {
    await writeFile(path.join(dir, "server-2026-04-10.log"), "a");
    await writeFile(path.join(dir, "server-2026-04-11.log"), "b");
    await writeFile(path.join(dir, "server-2026-04-12.log"), "c");
    await writeFile(path.join(dir, "unrelated.txt"), "x");
    const files = await listLogFiles(dir);
    assert.deepEqual(files, ["server-2026-04-12.log", "server-2026-04-11.log", "server-2026-04-10.log"]);
  });

  it("deletes oldest files beyond maxFiles", async () => {
    await enforceMaxFiles(dir, 2);
    const remaining = await readdir(dir);
    assert.ok(remaining.includes("server-2026-04-12.log"));
    assert.ok(remaining.includes("server-2026-04-11.log"));
    assert.ok(!remaining.includes("server-2026-04-10.log"));
    assert.ok(remaining.includes("unrelated.txt")); // non-log files untouched
  });

  it("is a no-op when maxFiles is 0 or negative", async () => {
    // Local bindings were previously named `before` / `after`,
    // which shadow the `node:test` lifecycle imports at the top
    // of the file and fail the `no-shadow` lint rule.
    const filesBefore = await readdir(dir);
    await enforceMaxFiles(dir, 0);
    await enforceMaxFiles(dir, -5);
    const filesAfter = await readdir(dir);
    assert.deepEqual(filesAfter.sort(), filesBefore.sort());
  });
});
