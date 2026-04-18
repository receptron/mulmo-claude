import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCatchUpPlan, type CatchUpTask } from "../src/catchup.ts";
import {
  emptyState,
  MISSED_RUN_POLICIES,
  SCHEDULE_TYPES,
  TASK_TRIGGERS,
  type TaskExecutionState,
} from "../src/types.ts";

function makeTask(
  overrides: Partial<CatchUpTask> & { id: string },
): CatchUpTask {
  return {
    name: overrides.id,
    schedule: { type: SCHEDULE_TYPES.daily, time: "08:00" },
    missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
    enabled: true,
    ...overrides,
  };
}

const apr14_09 = Date.UTC(2026, 3, 14, 9, 0);
const apr17_10 = Date.UTC(2026, 3, 17, 10, 0);

function stateAt(taskId: string, lastRunAt: string): TaskExecutionState {
  return { ...emptyState(taskId), lastRunAt };
}

describe("computeCatchUpPlan — skip policy", () => {
  it("produces no runs and records the skip", () => {
    const tasks = [
      makeTask({ id: "t", missedRunPolicy: MISSED_RUN_POLICIES.skip }),
    ];
    const states = new Map([
      ["t", stateAt("t", new Date(apr14_09).toISOString())],
    ]);
    const plan = computeCatchUpPlan(tasks, states, apr17_10);

    assert.equal(plan.runs.length, 0);
    assert.equal(plan.skipped.length, 1);
    assert.equal(plan.skipped[0].taskId, "t");
    assert.equal(plan.skipped[0].windowCount, 3);
  });
});

describe("computeCatchUpPlan — run-once policy", () => {
  it("produces one run targeting the latest missed window", () => {
    const tasks = [
      makeTask({ id: "t", missedRunPolicy: MISSED_RUN_POLICIES.runOnce }),
    ];
    const states = new Map([
      ["t", stateAt("t", new Date(apr14_09).toISOString())],
    ]);
    const plan = computeCatchUpPlan(tasks, states, apr17_10);

    assert.equal(plan.runs.length, 1);
    assert.equal(plan.runs[0].context.trigger, TASK_TRIGGERS.catchUp);
    // Latest window = Apr 17 08:00
    assert.ok(plan.runs[0].context.scheduledFor.includes("2026-04-17"));
  });
});

describe("computeCatchUpPlan — run-all policy", () => {
  it("produces one run per missed window, oldest first", () => {
    const tasks = [
      makeTask({ id: "t", missedRunPolicy: MISSED_RUN_POLICIES.runAll }),
    ];
    const states = new Map([
      ["t", stateAt("t", new Date(apr14_09).toISOString())],
    ]);
    const plan = computeCatchUpPlan(tasks, states, apr17_10);

    assert.equal(plan.runs.length, 3);
    assert.ok(plan.runs[0].context.scheduledFor.includes("2026-04-15"));
    assert.ok(plan.runs[1].context.scheduledFor.includes("2026-04-16"));
    assert.ok(plan.runs[2].context.scheduledFor.includes("2026-04-17"));
    plan.runs.forEach((r) =>
      assert.equal(r.context.trigger, TASK_TRIGGERS.catchUp),
    );
  });

  it("caps at maxCatchUp", () => {
    const tasks = [
      makeTask({
        id: "t",
        missedRunPolicy: MISSED_RUN_POLICIES.runAll,
        schedule: { type: SCHEDULE_TYPES.interval, intervalSec: 60 },
      }),
    ];
    // Last ran 1 hour ago — hundreds of 60s windows missed, capped to 3.
    const oneHourAgo = new Date(apr17_10 - 3_600_000).toISOString();
    const states = new Map([["t", stateAt("t", oneHourAgo)]]);
    const plan = computeCatchUpPlan(tasks, states, apr17_10, 3);
    assert.equal(plan.runs.length, 3);
  });
});

describe("computeCatchUpPlan — edge cases", () => {
  it("skips disabled tasks", () => {
    const tasks = [makeTask({ id: "t", enabled: false })];
    const plan = computeCatchUpPlan(tasks, new Map(), apr17_10);
    assert.equal(plan.runs.length, 0);
    assert.equal(plan.skipped.length, 0);
  });

  it("treats never-run tasks as just registered — no catch-up from epoch", () => {
    const tasks = [
      makeTask({ id: "t", missedRunPolicy: MISSED_RUN_POLICIES.runOnce }),
    ];
    const plan = computeCatchUpPlan(tasks, new Map(), apr17_10);
    // Never-run tasks: lastRunMs = nowMs, so no missed windows.
    assert.equal(plan.runs.length, 0);
  });

  it("returns empty plan when nothing is missed", () => {
    const tasks = [makeTask({ id: "t" })];
    const now = Date.UTC(2026, 3, 17, 8, 0); // exactly 08:00
    const states = new Map([["t", stateAt("t", new Date(now).toISOString())]]);
    const plan = computeCatchUpPlan(tasks, states, now);
    assert.equal(plan.runs.length, 0);
  });

  it("handles multiple tasks independently", () => {
    const tasks = [
      makeTask({ id: "a", missedRunPolicy: MISSED_RUN_POLICIES.skip }),
      makeTask({ id: "b", missedRunPolicy: MISSED_RUN_POLICIES.runAll }),
    ];
    const states = new Map([
      ["a", stateAt("a", new Date(apr14_09).toISOString())],
      ["b", stateAt("b", new Date(apr14_09).toISOString())],
    ]);
    const plan = computeCatchUpPlan(tasks, states, apr17_10);
    assert.equal(plan.skipped.length, 1); // a skipped
    assert.ok(plan.runs.length >= 1); // b has runs
    assert.ok(plan.runs.every((r) => r.taskId === "b"));
  });
});
