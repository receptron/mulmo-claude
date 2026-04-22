import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import { loadSchedulerOverrides } from "../../server/utils/files/scheduler-overrides-io.js";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "sched-override-test-"));
}

describe("loadSchedulerOverrides", () => {
  it("returns empty object when file does not exist", () => {
    const root = makeTmpDir();
    const result = loadSchedulerOverrides(root);
    assert.deepEqual(result, {});
  });

  it("loads valid overrides", () => {
    const root = makeTmpDir();
    const dir = path.join(root, "config", "scheduler");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "overrides.json"),
      JSON.stringify({
        "system:journal": { intervalMs: 7200000 },
        "system:chat-index": { time: "03:00" },
      }),
    );
    const result = loadSchedulerOverrides(root);
    assert.equal(result["system:journal"]?.intervalMs, 7200000);
    assert.equal(result["system:chat-index"]?.time, "03:00");
  });

  it("returns empty object for corrupt JSON", () => {
    const root = makeTmpDir();
    const dir = path.join(root, "config", "scheduler");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "overrides.json"), "NOT JSON");
    const result = loadSchedulerOverrides(root);
    assert.deepEqual(result, {});
  });

  it("returns empty object when file is an array", () => {
    const root = makeTmpDir();
    const dir = path.join(root, "config", "scheduler");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "overrides.json"), "[]");
    const result = loadSchedulerOverrides(root);
    assert.deepEqual(result, {});
  });
});
