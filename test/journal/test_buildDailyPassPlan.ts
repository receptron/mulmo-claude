// Coverage for the `buildDailyPassPlan` extraction (PR2 of #799).
// The full daily pass is integration-tested via session-end smoke
// runs; these checks exercise the planner's two top-level shapes:
// the "no work" early-return and the "work-to-do" plan object. They
// rely on a real tmp workspace because the planner does filesystem
// IO end-to-end (chat dir scan, session jsonl read, topic snapshot).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { buildDailyPassPlan, type DailyPassDeps } from "../../server/workspace/journal/dailyPass.js";
import { defaultState } from "../../server/workspace/journal/state.js";

// `Summarize` returns a Promise<string>; this stub should never be
// invoked because `buildDailyPassPlan` doesn't call the summarizer
// (it only does the read-only setup). If it ever does, the throw
// surfaces the regression loudly.
const noopSummarize: DailyPassDeps["summarize"] = async () => {
  throw new Error("Summarize should not be called from buildDailyPassPlan");
};

let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmo-daily-plan-"));
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("buildDailyPassPlan", () => {
  it("returns null when the chat dir does not exist (fresh install)", async () => {
    // Don't create chatDir — listSessionMetas returns empty, no
    // dirty sessions, planner returns null.
    const plan = await buildDailyPassPlan(defaultState(), {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set(),
    });
    assert.equal(plan, null);
  });

  it("returns null when the chat dir is empty", async () => {
    await mkdir(path.join(workspaceRoot, "conversations", "chat"), { recursive: true });
    const plan = await buildDailyPassPlan(defaultState(), {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set(),
    });
    assert.equal(plan, null);
  });

  it("returns a plan with workspaceRoot + initialNextState when there's a session to process", async () => {
    // A minimal session jsonl with one user text turn — enough for
    // listSessionMetas to find it and findDirtySessions to flag it
    // as new (empty processedSessions in defaultState).
    const sessionId = "11111111-1111-1111-1111-111111111111";
    const sessionFile = path.join(workspaceRoot, "conversations", "chat", `${sessionId}.jsonl`);
    await mkdir(path.dirname(sessionFile), { recursive: true });
    const event = {
      type: "user_message",
      timestamp: "2026-04-25T01:00:00Z",
      message: "hello",
    };
    await writeFile(sessionFile, JSON.stringify(event) + "\n");

    const plan = await buildDailyPassPlan(defaultState(), {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set(),
    });

    assert.ok(plan, "plan should not be null when there's a dirty session");
    assert.equal(plan.workspaceRoot, workspaceRoot);
    assert.ok(Array.isArray(plan.orderedDays));
    assert.ok(plan.newTopicsSeen instanceof Set);
    assert.equal(plan.initialNextState.knownTopics.length, 0);
    assert.ok(plan.dirtyMetaById.has(sessionId), "session should be in dirtyMetaById");
  });

  it("returns null when the only candidate session is in activeSessionIds (still being written)", async () => {
    // The previous test left a session file in place. Re-run with
    // that session marked active — planner should skip it and find
    // no dirty work.
    const activeId = "11111111-1111-1111-1111-111111111111";
    const plan = await buildDailyPassPlan(defaultState(), {
      workspaceRoot,
      summarize: noopSummarize,
      activeSessionIds: new Set([activeId]),
    });
    assert.equal(plan, null);
  });
});
