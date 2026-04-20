import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTaskManager } from "../../server/events/task-manager/index.js";

describe("task-manager dependsOn", () => {
  it("runs dependent task after its dependency succeeds", async () => {
    const order: string[] = [];
    const tm = createTaskManager({
      tickMs: 60_000,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    tm.registerTask({
      id: "parent",
      schedule: { type: "interval", intervalMs: 60_000 },
      run: async () => {
        order.push("parent");
      },
    });
    tm.registerTask({
      id: "child",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "parent",
      run: async () => {
        order.push("child");
      },
    });

    await tm.tick();
    assert.deepEqual(order, ["parent", "child"]);
  });

  it("skips dependent task when dependency fails", async () => {
    const order: string[] = [];
    const tm = createTaskManager({
      tickMs: 60_000,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    tm.registerTask({
      id: "parent",
      schedule: { type: "interval", intervalMs: 60_000 },
      run: async () => {
        order.push("parent-fail");
        throw new Error("boom");
      },
    });
    tm.registerTask({
      id: "child",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "parent",
      run: async () => {
        order.push("child");
      },
    });

    await tm.tick();
    assert.deepEqual(order, ["parent-fail"]);
  });

  it("skips dependent task when dependency is not due", async () => {
    const order: string[] = [];
    const tm = createTaskManager({
      tickMs: 60_000,
      // 00:01:00 — parent (every 120s) NOT due, child (every 60s) IS due
      now: () => new Date("2026-01-01T00:01:00Z"),
    });

    tm.registerTask({
      id: "parent",
      schedule: { type: "interval", intervalMs: 120_000 },
      run: async () => {
        order.push("parent");
      },
    });
    tm.registerTask({
      id: "child",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "parent",
      run: async () => {
        order.push("child");
      },
    });

    await tm.tick();
    // Parent not due at 00:01:00 (120s boundary = 00:00, 00:02, ...),
    // so child is skipped even though it's due
    assert.deepEqual(order, []);
  });

  it("chains multiple dependencies in order", async () => {
    const order: string[] = [];
    const tm = createTaskManager({
      tickMs: 60_000,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    tm.registerTask({
      id: "fetch",
      schedule: { type: "interval", intervalMs: 60_000 },
      run: async () => {
        order.push("fetch");
      },
    });
    tm.registerTask({
      id: "journal",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "fetch",
      run: async () => {
        order.push("journal");
      },
    });
    tm.registerTask({
      id: "memory",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "journal",
      run: async () => {
        order.push("memory");
      },
    });

    await tm.tick();
    assert.deepEqual(order, ["fetch", "journal", "memory"]);
  });

  it("skips dependent when dependsOn references a nonexistent task", async () => {
    const order: string[] = [];
    const tm = createTaskManager({
      tickMs: 60_000,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    tm.registerTask({
      id: "orphan",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "nonexistent",
      run: async () => {
        order.push("orphan");
      },
    });

    await tm.tick();
    assert.deepEqual(order, []);
  });

  it("skips dependent when parent is disabled", async () => {
    const order: string[] = [];
    const tm = createTaskManager({
      tickMs: 60_000,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    tm.registerTask({
      id: "parent",
      schedule: { type: "interval", intervalMs: 60_000 },
      enabled: false,
      run: async () => {
        order.push("parent");
      },
    });
    tm.registerTask({
      id: "child",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "parent",
      run: async () => {
        order.push("child");
      },
    });

    await tm.tick();
    assert.deepEqual(order, []);
  });

  it("independent tasks run regardless of dependent task failures", async () => {
    const order: string[] = [];
    const tm = createTaskManager({
      tickMs: 60_000,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    tm.registerTask({
      id: "independent",
      schedule: { type: "interval", intervalMs: 60_000 },
      run: async () => {
        order.push("independent");
      },
    });
    tm.registerTask({
      id: "parent",
      schedule: { type: "interval", intervalMs: 60_000 },
      run: async () => {
        order.push("parent");
        throw new Error("boom");
      },
    });
    tm.registerTask({
      id: "child",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "parent",
      run: async () => {
        order.push("child");
      },
    });

    await tm.tick();
    // independent and parent both run (parallel), child skipped
    assert.ok(order.includes("independent"));
    assert.ok(order.includes("parent"));
    assert.ok(!order.includes("child"));
  });

  it("previous tick success does not carry over to next tick", async () => {
    const order: string[] = [];
    let tickCount = 0;
    // Advance time between ticks so tickId changes
    let fakeTime = new Date("2026-01-01T00:00:00Z");
    const tm = createTaskManager({
      tickMs: 60_000,
      now: () => fakeTime,
    });

    tm.registerTask({
      id: "parent",
      schedule: { type: "interval", intervalMs: 60_000 },
      run: async () => {
        tickCount++;
        if (tickCount === 2) throw new Error("fail on second tick");
        order.push("parent");
      },
    });
    tm.registerTask({
      id: "child",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "parent",
      run: async () => {
        order.push("child");
      },
    });

    await tm.tick(); // tick 1: parent succeeds → child runs
    assert.deepEqual(order, ["parent", "child"]);

    order.length = 0;
    fakeTime = new Date("2026-01-01T00:01:00Z"); // advance 1 tick
    await tm.tick(); // tick 2: parent fails → child skipped
    assert.deepEqual(order, []);
  });

  it("stale success does not leak across tick() calls in same bucket", async () => {
    const order: string[] = [];
    // Fixed time — both tick() calls resolve to the same tickId
    const tm = createTaskManager({
      tickMs: 60_000,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    let parentEnabled = true;
    tm.registerTask({
      id: "parent",
      schedule: { type: "interval", intervalMs: 60_000 },
      run: async () => {
        if (!parentEnabled) throw new Error("disabled");
        order.push("parent");
      },
    });
    tm.registerTask({
      id: "child",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "parent",
      run: async () => {
        order.push("child");
      },
    });

    await tm.tick(); // parent succeeds → child runs
    assert.deepEqual(order, ["parent", "child"]);

    order.length = 0;
    parentEnabled = false;
    await tm.tick(); // same tickId, but parent fails → child must NOT run
    assert.deepEqual(order, []);
  });

  it("includes dependsOn in listTasks output", () => {
    const tm = createTaskManager();
    tm.registerTask({
      id: "a",
      schedule: { type: "interval", intervalMs: 60_000 },
      run: async () => {},
    });
    tm.registerTask({
      id: "b",
      schedule: { type: "interval", intervalMs: 60_000 },
      dependsOn: "a",
      run: async () => {},
    });

    const tasks = tm.listTasks();
    const b = tasks.find((t) => t.id === "b");
    assert.equal(b?.dependsOn, "a");
  });
});
