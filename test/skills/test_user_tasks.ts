import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import { loadUserTasks, validateAndCreate, applyUpdate } from "../../server/workspace/skills/user-tasks.ts";
import { saveUserTasks } from "../../server/utils/files/user-tasks-io.ts";
import { SCHEDULE_TYPES, MISSED_RUN_POLICIES } from "@receptron/task-scheduler";
import { ONE_MINUTE_MS, ONE_HOUR_MS } from "../../server/utils/time.ts";

function tmpRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "user-tasks-"));
  mkdirSync(path.join(dir, "config", "scheduler"), { recursive: true });
  return dir;
}

describe("loadUserTasks", () => {
  it("returns empty array when file does not exist", () => {
    const root = tmpRoot();
    const tasks = loadUserTasks(root);
    assert.deepEqual(tasks, []);
  });

  it("loads tasks from file", () => {
    const root = tmpRoot();
    const data = [
      {
        id: "abc",
        name: "Test",
        description: "",
        schedule: { type: SCHEDULE_TYPES.daily, time: "08:00" },
        missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
        enabled: true,
        roleId: "general",
        prompt: "hello",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    writeFileSync(path.join(root, "config", "scheduler", "tasks.json"), JSON.stringify(data));
    const tasks = loadUserTasks(root);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].name, "Test");
  });

  it("returns empty array for corrupted JSON", () => {
    const root = tmpRoot();
    writeFileSync(path.join(root, "config", "scheduler", "tasks.json"), "not json");
    const tasks = loadUserTasks(root);
    assert.deepEqual(tasks, []);
  });
});

describe("saveUserTasks", () => {
  it("writes tasks to file", async () => {
    const root = tmpRoot();
    const schedule = {
      type: SCHEDULE_TYPES.interval,
      intervalMs: ONE_MINUTE_MS,
    };
    const tasks = [
      {
        id: "xyz",
        name: "Saved",
        description: "",
        schedule,
        missedRunPolicy: MISSED_RUN_POLICIES.skip,
        enabled: true,
        roleId: "general",
        prompt: "test",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    await saveUserTasks(tasks, root);
    const raw = readFileSync(path.join(root, "config", "scheduler", "tasks.json"), "utf-8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "Saved");
  });
});

describe("validateAndCreate", () => {
  it("creates a valid task", () => {
    const result = validateAndCreate({
      name: "Daily news",
      prompt: "Summarize the news",
      schedule: { type: SCHEDULE_TYPES.daily, time: "08:00" },
    });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.task.name, "Daily news");
      assert.equal(result.task.prompt, "Summarize the news");
      assert.equal(result.task.enabled, true);
      assert.equal(result.task.missedRunPolicy, MISSED_RUN_POLICIES.runOnce);
      assert.ok(result.task.id.length > 0);
    }
  });

  it("rejects missing name", () => {
    const result = validateAndCreate({
      prompt: "hello",
      schedule: { type: SCHEDULE_TYPES.daily, time: "08:00" },
    });
    assert.equal(result.kind, "error");
  });

  it("rejects missing prompt", () => {
    const result = validateAndCreate({
      name: "Test",
      schedule: { type: SCHEDULE_TYPES.daily, time: "08:00" },
    });
    assert.equal(result.kind, "error");
  });

  it("rejects invalid schedule", () => {
    const result = validateAndCreate({
      name: "Test",
      prompt: "hello",
      schedule: { type: "weekly", days: [1] },
    });
    assert.equal(result.kind, "error");
  });

  it("rejects null body", () => {
    const result = validateAndCreate(null);
    assert.equal(result.kind, "error");
  });

  it("accepts custom missedRunPolicy", () => {
    const result = validateAndCreate({
      name: "Metrics",
      prompt: "Ping metrics",
      schedule: { type: SCHEDULE_TYPES.interval, intervalMs: ONE_HOUR_MS },
      missedRunPolicy: MISSED_RUN_POLICIES.runAll,
    });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.task.missedRunPolicy, MISSED_RUN_POLICIES.runAll);
    }
  });
});

describe("applyUpdate", () => {
  const dailySchedule = {
    type: SCHEDULE_TYPES.daily,
    time: "08:00",
  };
  const baseTasks = [
    {
      id: "t1",
      name: "Original",
      description: "desc",
      schedule: dailySchedule,
      missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
      enabled: true,
      roleId: "general",
      prompt: "do stuff",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];

  it("updates name", () => {
    const result = applyUpdate([...baseTasks], "t1", { name: "Updated" });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.tasks[0].name, "Updated");
    }
  });

  it("updates enabled", () => {
    const result = applyUpdate([...baseTasks], "t1", { enabled: false });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.tasks[0].enabled, false);
    }
  });

  it("returns error for unknown id", () => {
    const result = applyUpdate([...baseTasks], "unknown", { name: "X" });
    assert.equal(result.kind, "error");
  });

  it("ignores invalid schedule", () => {
    const result = applyUpdate([...baseTasks], "t1", {
      schedule: { type: "nope" },
    });
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      // Schedule unchanged
      assert.equal(result.tasks[0].schedule.type, SCHEDULE_TYPES.daily);
    }
  });
});
